import "server-only";
import { QUESTIONS_PER_DAY } from "@/config/game";
import { getDb, type Sql } from "@/lib/db";
import { env } from "@/lib/env";
import { pickDailySet, type PoolQuestion } from "@/lib/scheduler";
import { addDays, challengeNumber, gameDateOf } from "@/lib/time";
import { now } from "@/lib/server/clock";
import { audit, notifyAdmin } from "@/lib/server/notify";

export interface ChallengeRow {
  id: string;
  challenge_date: string;
  number: number;
  status: "scheduled" | "published";
  is_demo: boolean;
  source: "manual" | "auto" | "reserve";
  published_at: Date | null;
}

export function today(): string {
  return gameDateOf(now());
}

async function lockDate(sql: Sql, date: string): Promise<void> {
  await sql.query("select pg_advisory_xact_lock(hashtext($1))", [`challenge:${date}`]);
}

/** Approved questions never used in any challenge. Demo content only where allowed. */
export async function eligiblePool(sql: Sql, allowDemo = env.allowDemoContent): Promise<PoolQuestion[]> {
  return sql.query<PoolQuestion>(
    `select q.id, q.prompt, q.category, q.difficulty, q.subject_key as "subjectKey"
       from questions q
      where q.status = 'approved'
        and ($1 or not q.is_demo)
        and not exists (select 1 from challenge_questions cq where cq.question_id = q.id)`,
    [allowDemo],
  );
}

async function recentSubjects(sql: Sql, date: string, windowDays = 30) {
  return sql.query<{ prompt: string; subjectKey: string }>(
    `select q.prompt, q.subject_key as "subjectKey"
       from challenge_questions cq
       join daily_challenges dc on dc.id = cq.challenge_id
       join questions q on q.id = cq.question_id
      where dc.challenge_date between $1::date and $2::date and dc.challenge_date <> $3::date`,
    [addDays(date, -windowDays), addDays(date, windowDays), date],
  );
}

/** Create a scheduled (not yet published) challenge for a date if there is none. */
export async function scheduleDate(
  sql: Sql,
  date: string,
  opts: { source: ChallengeRow["source"]; actor: string; emergency?: boolean },
): Promise<ChallengeRow | null> {
  await lockDate(sql, date);
  const existing = await sql.one<ChallengeRow>("select * from daily_challenges where challenge_date = $1", [date]);
  if (existing) return existing;
  const pool = await eligiblePool(sql);
  const picked = pickDailySet(pool, { seed: date, recent: await recentSubjects(sql, date), emergency: opts.emergency });
  if (!picked) return null;
  const demoCount = (
    await sql.query<{ n: number }>("select count(*)::int as n from questions where id = any($1::uuid[]) and is_demo", [
      picked.map((p) => p.id),
    ])
  )[0].n;
  const ch = await sql.one<ChallengeRow>(
    `insert into daily_challenges (challenge_date, number, is_demo, source, created_by)
     values ($1, $2, $3, $4, $5) returning *`,
    [date, challengeNumber(date), demoCount > 0, opts.source, opts.actor],
  );
  for (let i = 0; i < picked.length; i++) {
    await sql.query("insert into challenge_questions (challenge_id, position, question_id) values ($1, $2, $3)", [
      ch!.id,
      i + 1,
      picked[i].id,
    ]);
  }
  await audit(opts.actor, "schedule", "daily_challenge", ch!.id, { date, source: opts.source, questions: picked.map((p) => p.id) }, sql);
  return ch;
}

/**
 * Publish atomically: verify each scheduled question is still approved (and
 * allowed), replace any that are not from the reserve, snapshot every field
 * players are judged on, then flip the status. After this the database
 * refuses changes to the snapshot.
 */
export async function publishChallenge(sql: Sql, challengeId: string, actor: string): Promise<ChallengeRow> {
  const ch = await sql.one<ChallengeRow>("select * from daily_challenges where id = $1 for update", [challengeId]);
  if (!ch) throw new Error("challenge not found");
  if (ch.status === "published") return ch;

  const slots = await sql.query<{ position: number; question_id: string; status: string; is_demo: boolean; difficulty: string }>(
    `select cq.position, cq.question_id, q.status, q.is_demo, q.difficulty
       from challenge_questions cq join questions q on q.id = cq.question_id
      where cq.challenge_id = $1 order by cq.position`,
    [challengeId],
  );
  const allowDemo = env.allowDemoContent;
  const bad = slots.filter((s) => s.status !== "approved" || (s.is_demo && !allowDemo));
  const missingPositions = Array.from({ length: QUESTIONS_PER_DAY }, (_, i) => i + 1).filter(
    (p) => !slots.some((s) => s.position === p),
  );
  if (bad.length || missingPositions.length) {
    const pool = await eligiblePool(sql, allowDemo);
    const keep = slots.filter((s) => !bad.includes(s));
    for (const s of bad) {
      await sql.query("delete from challenge_questions where challenge_id = $1 and position = $2", [challengeId, s.position]);
    }
    const need = [...bad.map((b) => ({ position: b.position, difficulty: b.difficulty })), ...missingPositions.map((p) => ({ position: p, difficulty: "medium" }))];
    const usedIds = new Set(keep.map((k) => k.question_id));
    for (const n of need) {
      const choice =
        pool.find((q) => !usedIds.has(q.id) && q.difficulty === n.difficulty) ?? pool.find((q) => !usedIds.has(q.id));
      if (!choice) {
        await notifyAdmin("publish_failed", "error", `Could not publish ${ch.challenge_date}: no approved replacement question.`, `publish:${ch.challenge_date}`, sql);
        throw new Error("no replacement available");
      }
      usedIds.add(choice.id);
      await sql.query("insert into challenge_questions (challenge_id, position, question_id) values ($1, $2, $3)", [
        challengeId,
        n.position,
        choice.id,
      ]);
    }
    await notifyAdmin(
      "publish_replaced",
      "warning",
      `${ch.challenge_date}: ${need.length} scheduled question(s) were no longer approved and were replaced from the reserve.`,
      undefined,
      sql,
    );
  }

  await sql.query(
    `update challenge_questions cq set
        prompt = q.prompt, answer = q.answer, unit = q.unit, category = q.category, difficulty = q.difficulty,
        scoring_type = q.scoring_type, tolerance = q.tolerance, allow_decimal = q.allow_decimal,
        allow_negative = q.allow_negative, explanation = q.explanation, source_url = q.source_url,
        source_title = q.source_title, reference_period = q.reference_period
       from questions q
      where q.id = cq.question_id and cq.challenge_id = $1`,
    [challengeId],
  );
  const demo = await sql.one<{ d: boolean }>(
    `select coalesce(bool_or(q.is_demo), false) as d from challenge_questions cq join questions q on q.id = cq.question_id where cq.challenge_id = $1`,
    [challengeId],
  );
  const published = await sql.one<ChallengeRow>(
    "update daily_challenges set is_demo = $2, status = 'published', published_at = $3 where id = $1 returning *",
    [challengeId, demo?.d ?? false, now()],
  );
  await audit(actor, "publish", "daily_challenge", challengeId, { date: ch.challenge_date }, sql);
  return published!;
}

/**
 * The challenge players can play for a date: published on demand. Only today
 * or earlier — future challenges are never exposed. If nothing is scheduled
 * for today, a set is assembled from the approved reserve (never from
 * unapproved content) and the admin is notified.
 */
export async function getPlayableChallenge(date: string): Promise<ChallengeRow | null> {
  if (date > today()) return null;
  const db = await getDb();
  const existing = await db.one<ChallengeRow>("select * from daily_challenges where challenge_date = $1", [date]);
  if (existing?.status === "published") return existing;
  // Past dates that were never published stay unplayable.
  if (date !== today()) return null;

  return db.tx(async (sql) => {
    await lockDate(sql, date);
    let ch = await sql.one<ChallengeRow>("select * from daily_challenges where challenge_date = $1", [date]);
    if (!ch) {
      ch = await scheduleDate(sql, date, { source: "reserve", actor: "system", emergency: true });
      if (!ch) {
        await notifyAdmin(
          "no_challenge",
          "error",
          `No challenge could be assembled for ${date}: not enough approved questions in the reserve.`,
          `no_challenge:${date}`,
          sql,
        );
        return null;
      }
      await notifyAdmin("reserve_used", "warning", `Nothing was scheduled for ${date}; it was assembled from the approved reserve.`, `reserve:${date}`, sql);
    }
    if (ch.status !== "published") {
      try {
        ch = await publishChallenge(sql, ch.id, "system");
      } catch {
        return null;
      }
    }
    return ch;
  });
}

/** Schedule every missing date in [from, from + days). */
export async function fillSchedule(
  from: string,
  days: number,
  actor: string,
  source: ChallengeRow["source"] = "manual",
): Promise<{ created: string[]; missing: string[] }> {
  const db = await getDb();
  const created: string[] = [];
  const missing: string[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const result = await db.tx(async (sql) => {
      const before = await sql.one("select 1 from daily_challenges where challenge_date = $1", [date]);
      if (before) return "exists" as const;
      const ch = await scheduleDate(sql, date, { source, actor });
      return ch ? ("created" as const) : ("missing" as const);
    });
    if (result === "created") created.push(date);
    if (result === "missing") missing.push(date);
  }
  return { created, missing };
}

export interface InventoryStatus {
  today: string;
  scheduledAheadDays: number;
  firstUnscheduledDate: string | null;
  unscheduledApproved: number;
  inventoryDays: number;
  reviewQueue: number;
  byCategory: Record<string, number>;
  byDifficulty: Record<string, number>;
}

export async function inventoryStatus(lookaheadDays = 60): Promise<InventoryStatus> {
  const db = await getDb();
  const t = today();
  const scheduled = new Set(
    (
      await db.query<{ d: string }>(
        "select challenge_date as d from daily_challenges where challenge_date >= $1 and challenge_date < $2",
        [t, addDays(t, lookaheadDays)],
      )
    ).map((r) => r.d),
  );
  let consecutive = 0;
  while (scheduled.has(addDays(t, consecutive))) consecutive++;
  const pool = await eligiblePool(db);
  const byCategory: Record<string, number> = {};
  const byDifficulty: Record<string, number> = {};
  for (const q of pool) {
    byCategory[q.category] = (byCategory[q.category] ?? 0) + 1;
    byDifficulty[q.difficulty] = (byDifficulty[q.difficulty] ?? 0) + 1;
  }
  const review = await db.one<{ n: number }>("select count(*)::int as n from questions where status = 'review'");
  return {
    today: t,
    scheduledAheadDays: consecutive,
    firstUnscheduledDate: addDays(t, consecutive),
    unscheduledApproved: pool.length,
    inventoryDays: scheduled.size + Math.floor(pool.length / QUESTIONS_PER_DAY),
    reviewQueue: review?.n ?? 0,
    byCategory,
    byDifficulty,
  };
}
