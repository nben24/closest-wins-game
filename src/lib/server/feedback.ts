import "server-only";
import { getDb, type Sql } from "@/lib/db";
import { formatNickname } from "@/lib/names";
import { ApiError } from "@/lib/server/errors";
import { notifyAdmin } from "@/lib/server/notify";

/**
 * Player feedback on questions: a thumbs up/down ("fun question?") and an
 * optional "something's wrong" report. Only allowed after the player finished
 * that day, so it can't be used to probe answers mid-game. Only the admin sees
 * it (never other players).
 */

export const REPORT_MAX_CHARS = 300;

export interface MyFeedback {
  position: number;
  reaction: -1 | 1 | null;
  reported: boolean;
}

async function finishedChallenge(sql: Sql, playerId: string, date: string): Promise<{ id: string }> {
  const ch = await sql.one<{ id: string }>(
    `select dc.id from daily_challenges dc
       join attempts a on a.challenge_id = dc.id and a.player_id = $1 and a.status = 'completed'
      where dc.challenge_date = $2 and dc.status = 'published'`,
    [playerId, date],
  );
  if (!ch) throw new ApiError(403, "not_finished", "Finish the day's game first.");
  return ch;
}

export async function myFeedback(playerId: string, challengeId: string): Promise<MyFeedback[]> {
  const db = await getDb();
  const rows = await db.query<{ position: number; reaction: number | null; report: string | null }>(
    "select position, reaction, report from question_feedback where player_id = $1 and challenge_id = $2 order by position",
    [playerId, challengeId],
  );
  return rows.map((r) => ({ position: r.position, reaction: r.reaction === 1 ? 1 : r.reaction === -1 ? -1 : null, reported: r.report !== null }));
}

/** Set (or clear, with null) the player's thumbs up/down on one question. */
export async function setReaction(playerId: string, date: string, position: number, reaction: -1 | 1 | null): Promise<void> {
  const db = await getDb();
  await db.tx(async (sql) => {
    const ch = await finishedChallenge(sql, playerId, date);
    await sql.query(
      `insert into question_feedback (player_id, challenge_id, position, reaction) values ($1, $2, $3, $4)
       on conflict (player_id, challenge_id, position) do update set reaction = excluded.reaction, updated_at = now()`,
      [playerId, ch.id, position, reaction],
    );
  });
}

/**
 * Report a problem with one question. One report per player per question (a
 * second one replaces the first), so a player can send at most five a day; the
 * admin gets one notification per question until it's handled.
 */
export async function reportProblem(playerId: string, date: string, position: number, text: string): Promise<void> {
  const report = text.replace(/\s+/g, " ").trim().slice(0, REPORT_MAX_CHARS);
  if (!report) throw new ApiError(400, "empty_report", "Say what looks wrong.");
  const db = await getDb();
  await db.tx(async (sql) => {
    const ch = await finishedChallenge(sql, playerId, date);
    await sql.query(
      `insert into question_feedback (player_id, challenge_id, position, report, reported_at) values ($1, $2, $3, $4, now())
       on conflict (player_id, challenge_id, position) do update
         set report = excluded.report, reported_at = now(), report_resolved_at = null, updated_at = now()`,
      [playerId, ch.id, position, report],
    );
    await notifyAdmin(
      "player_report",
      "warning",
      `A player reported a problem with ${date} Q${position}. See Admin → Answers for that day.`,
      `report:${date}:${position}`,
      sql,
    );
  });
}

// --- admin -------------------------------------------------------------------

export interface QuestionFeedbackSummary {
  position: number;
  up: number;
  down: number;
  reports: { name: string; text: string; at: string; resolved: boolean }[];
}

/** Admin only: reactions and reports for each question of a challenge. */
export async function challengeFeedback(challengeId: string): Promise<QuestionFeedbackSummary[]> {
  const db = await getDb();
  const rows = await db.query<{
    position: number; reaction: number | null; report: string | null; reported_at: Date | null; report_resolved_at: Date | null;
    name_adjective: string; name_noun: string; name_suffix: number | null;
  }>(
    `select f.position, f.reaction, f.report, f.reported_at, f.report_resolved_at, p.name_adjective, p.name_noun, p.name_suffix
       from question_feedback f join players p on p.id = f.player_id
      where f.challenge_id = $1 order by f.position, f.reported_at`,
    [challengeId],
  );
  const out = new Map<number, QuestionFeedbackSummary>();
  for (const r of rows) {
    const s = out.get(r.position) ?? { position: r.position, up: 0, down: 0, reports: [] };
    if (r.reaction === 1) s.up++;
    if (r.reaction === -1) s.down++;
    if (r.report) {
      s.reports.push({
        name: formatNickname(r.name_adjective, r.name_noun, r.name_suffix),
        text: r.report,
        at: new Date(r.reported_at!).toISOString(),
        resolved: r.report_resolved_at !== null,
      });
    }
    out.set(r.position, s);
  }
  return [...out.values()];
}

/** Admin only: mark every report on one question as handled (and clear its dashboard alert). */
export async function resolveReports(challengeId: string, position: number): Promise<void> {
  const db = await getDb();
  await db.tx(async (sql) => {
    await sql.query(
      "update question_feedback set report_resolved_at = now(), updated_at = now() where challenge_id = $1 and position = $2 and report is not null and report_resolved_at is null",
      [challengeId, position],
    );
    const ch = await sql.one<{ date: string }>("select challenge_date::text as date from daily_challenges where id = $1", [challengeId]);
    if (ch) {
      await sql.query("update admin_notifications set resolved_at = now() where dedupe_key = $1 and resolved_at is null", [`report:${ch.date}:${position}`]);
    }
  });
}
