import "server-only";
import { getDb } from "@/lib/db";
import { addDays } from "@/lib/time";
import { today } from "@/lib/server/challenges";
import { ApiError } from "@/lib/server/errors";
import { audit } from "@/lib/server/notify";

export interface UpcomingChallenge {
  id: string;
  date: string;
  number: number;
  status: string;
  isDemo: boolean;
  source: string;
  questions: { position: number; questionId: string; prompt: string; category: string; difficulty: string; answer: number; unit: string; voided: boolean; status: string }[];
  attempts: number;
  completed: number;
}

export async function listChallenges(from: string, days: number): Promise<UpcomingChallenge[]> {
  const db = await getDb();
  const chs = await db.query<{ id: string; challenge_date: string; number: number; status: string; is_demo: boolean; source: string; attempts: number; completed: number }>(
    `select dc.*, (select count(*)::int from attempts a where a.challenge_id = dc.id) as attempts,
            (select count(*)::int from attempts a where a.challenge_id = dc.id and a.status = 'completed') as completed
       from daily_challenges dc where challenge_date between $1::date and $2::date order by challenge_date`,
    [from, addDays(from, days - 1)],
  );
  const out: UpcomingChallenge[] = [];
  for (const c of chs) {
    const qs = await db.query<{ position: number; question_id: string; prompt: string; category: string; difficulty: string; answer: number; unit: string; voided: boolean; status: string }>(
      `select cq.position, cq.question_id, coalesce(cq.prompt, q.prompt) as prompt, q.category, q.difficulty,
              coalesce(cq.answer, q.answer) as answer, coalesce(cq.unit, q.unit) as unit, cq.voided, q.status
         from challenge_questions cq join questions q on q.id = cq.question_id where cq.challenge_id = $1 order by cq.position`,
      [c.id],
    );
    out.push({
      id: c.id, date: c.challenge_date, number: c.number, status: c.status, isDemo: c.is_demo, source: c.source, attempts: c.attempts, completed: c.completed,
      questions: qs.map((q) => ({ position: q.position, questionId: q.question_id, prompt: q.prompt, category: q.category, difficulty: q.difficulty, answer: q.answer, unit: q.unit, voided: q.voided, status: q.status })),
    });
  }
  return out;
}

/** Remove a scheduled (unpublished, future) day so its questions return to the reserve. */
export async function unscheduleDay(challengeId: string, actor: string): Promise<void> {
  const db = await getDb();
  await db.tx(async (sql) => {
    const c = await sql.one<{ status: string; challenge_date: string }>("select status, challenge_date from daily_challenges where id = $1 for update", [challengeId]);
    if (!c) throw new ApiError(404, "not_found", "Not found.");
    if (c.status === "published") throw new ApiError(400, "published", "Published challenges can't be removed. Void a question instead.");
    if (c.challenge_date <= today()) throw new ApiError(400, "today", "Today's challenge can't be unscheduled.");
    await sql.query("delete from daily_challenges where id = $1", [challengeId]);
    await audit(actor, "unschedule", "daily_challenge", challengeId, { date: c.challenge_date }, sql);
  });
}

/** Swap one question in a scheduled (unpublished) day for another approved, unused question. */
export async function swapQuestion(challengeId: string, position: number, questionId: string, actor: string): Promise<void> {
  const db = await getDb();
  await db.tx(async (sql) => {
    const c = await sql.one<{ status: string }>("select status from daily_challenges where id = $1 for update", [challengeId]);
    if (!c) throw new ApiError(404, "not_found", "Not found.");
    if (c.status === "published") throw new ApiError(400, "published", "Published challenges are immutable.");
    const used = await sql.one("select 1 from challenge_questions where question_id = $1", [questionId]);
    if (used) throw new ApiError(409, "used", "That question is already scheduled or used.");
    await sql.query("update challenge_questions set question_id = $3 where challenge_id = $1 and position = $2", [challengeId, position, questionId]);
    await audit(actor, "swap", "daily_challenge", challengeId, { position, questionId }, sql);
  });
}

export interface Stats {
  players: number;
  activePlayers7d: number;
  groups: number;
  days: { date: string; started: number; completed: number; avgScore: number | null }[];
}

export async function participationStats(days = 14): Promise<Stats> {
  const db = await getDb();
  const t = today();
  const players = (await db.one<{ n: number }>("select count(*)::int as n from players"))!.n;
  const active = (await db.one<{ n: number }>("select count(*)::int as n from players where last_seen_at > now() - interval '7 days'"))!.n;
  const groups = (await db.one<{ n: number }>("select count(*)::int as n from groups"))!.n;
  const rows = await db.query<{ date: string; started: number; completed: number; avg: number | null }>(
    `select dc.challenge_date as date, count(a.id)::int as started,
            count(a.id) filter (where a.status = 'completed')::int as completed,
            round(avg(a.total_score) filter (where a.status = 'completed'))::int as avg
       from daily_challenges dc left join attempts a on a.challenge_id = dc.id
      where dc.challenge_date between $1::date and $2::date group by dc.challenge_date order by dc.challenge_date desc`,
    [addDays(t, -(days - 1)), t],
  );
  return { players, activePlayers7d: active, groups, days: rows.map((r) => ({ date: r.date, started: r.started, completed: r.completed, avgScore: r.avg })) };
}

export async function openNotifications(): Promise<{ id: string; kind: string; severity: string; message: string; created_at: Date }[]> {
  const db = await getDb();
  return db.query("select id, kind, severity, message, created_at from admin_notifications where resolved_at is null order by created_at desc limit 50");
}

export async function resolveNotification(id: string, actor: string): Promise<void> {
  const db = await getDb();
  await db.query("update admin_notifications set resolved_at = now() where id = $1", [id]);
  await audit(actor, "resolve_notification", "admin_notification", id);
}
