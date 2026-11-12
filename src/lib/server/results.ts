import "server-only";
import { getDb } from "@/lib/db";
import { TIMING } from "@/config/game";
import { now } from "@/lib/server/clock";
import { ApiError } from "@/lib/server/errors";
import { groupComparisons, type GroupComparison } from "@/lib/server/groups";
import type { RoundView } from "@/lib/server/play";
import { recomputeAttempt } from "@/lib/server/play";
import { everyoneStats, type EveryoneStats } from "@/lib/server/leaderboard";

export interface ResultsView {
  challenge: { id: string; date: string; number: number; isDemo: boolean };
  attempt: { status: "in_progress" | "completed"; totalScore: number; roundsFinished: number; maxScore: number } | null;
  rounds: RoundView[];
  groups: GroupComparison[] | null;
  /** Comparison with everyone who finished (only after the viewer completes). */
  everyone: EveryoneStats | null;
}

/** A player's own results for a date, plus group comparisons once completed. */
export async function getResults(playerId: string, date: string): Promise<ResultsView> {
  const db = await getDb();
  const ch = await db.one<{ id: string; challenge_date: string; number: number; is_demo: boolean }>(
    "select id, challenge_date, number, is_demo from daily_challenges where challenge_date = $1 and status = 'published'",
    [date],
  );
  if (!ch) throw new ApiError(404, "not_found", "No challenge for that day.");
  const challenge = { id: ch.id, date: ch.challenge_date, number: ch.number, isDemo: ch.is_demo };
  let attempt = await db.one<{ id: string; status: "in_progress" | "completed"; total_score: number; rounds_finished: number }>(
    "select id, status, total_score, rounds_finished from attempts where player_id = $1 and challenge_id = $2",
    [playerId, ch.id],
  );
  if (!attempt) return { challenge, attempt: null, rounds: [], groups: null, everyone: null };

  // Finalize anything expired so results are consistent.
  const at = now();
  await db.tx(async (sql) => {
    await sql.query("select 1 from attempts where id = $1 for update", [attempt!.id]);
    const n = await sql.query(
      `update rounds set status = 'timed_out', score = 0, finalized_at = $2
        where attempt_id = $1 and status = 'open' and deadline_at + make_interval(secs => $3) < $2 returning id`,
      [attempt!.id, at, TIMING.submitGraceMs / 1000],
    );
    if (n.length) await recomputeAttempt(sql, attempt!.id, at);
  });
  attempt = (await db.one<typeof attempt>("select id, status, total_score, rounds_finished from attempts where id = $1", [attempt.id]))!;

  const rows = await db.query<{
    position: number; status: RoundView["status"]; guess: number | null; score: number | null;
    reading_started_at: Date; answer_opens_at: Date; deadline_at: Date;
    prompt: string; answer: number; unit: string; category: string; scoring_type: RoundView["scoringType"]; tolerance: number;
    allow_decimal: boolean; allow_negative: boolean; explanation: string; source_url: string | null; source_title: string | null;
    reference_period: string | null; voided: boolean; voided_reason: string | null;
  }>(
    `select r.position, r.status, r.guess, r.score, r.reading_started_at, r.answer_opens_at, r.deadline_at,
            cq.prompt, cq.answer, cq.unit, cq.category, cq.scoring_type, cq.tolerance, cq.allow_decimal, cq.allow_negative,
            cq.explanation, cq.source_url, cq.source_title, cq.reference_period, cq.voided, cq.voided_reason
       from rounds r join challenge_questions cq on cq.challenge_id = $2 and cq.position = r.position
      where r.attempt_id = $1 and r.status <> 'open' order by r.position`,
    [attempt.id, ch.id],
  );
  const voidedCount = (await db.one<{ n: number }>("select count(*)::int as n from challenge_questions where challenge_id = $1 and voided", [ch.id]))!.n;
  const rounds: RoundView[] = rows.map((r) => ({
    position: r.position,
    prompt: r.prompt,
    unit: r.unit,
    category: r.category,
    scoringType: r.scoring_type,
    allowDecimal: r.allow_decimal,
    allowNegative: r.allow_negative,
    status: r.status,
    readingStartedAt: r.reading_started_at.toISOString(),
    answerOpensAt: r.answer_opens_at.toISOString(),
    deadlineAt: r.deadline_at.toISOString(),
    reveal: {
      guess: r.status === "answered" ? r.guess : null,
      answer: r.answer,
      score: r.voided ? 0 : (r.score ?? 0),
      explanation: r.explanation,
      sourceUrl: r.source_url,
      sourceTitle: r.source_title,
      referencePeriod: r.reference_period,
      tolerance: r.tolerance,
      voided: r.voided,
      voidedReason: r.voided_reason,
    },
  }));
  return {
    challenge,
    attempt: {
      status: attempt.status,
      totalScore: attempt.total_score,
      roundsFinished: attempt.rounds_finished,
      maxScore: (5 - voidedCount) * 1000,
    },
    rounds,
    groups: attempt.status === "completed" ? await groupComparisons(playerId, ch.id) : null,
    everyone: attempt.status === "completed" ? await everyoneStats(playerId, ch.id) : null,
  };
}

export async function getHistory(playerId: string): Promise<{ date: string; number: number; total: number; status: string; isDemo: boolean }[]> {
  const db = await getDb();
  return db.query(
    `select dc.challenge_date as date, dc.number, a.total_score as total, a.status, dc.is_demo as "isDemo"
       from attempts a join daily_challenges dc on dc.id = a.challenge_id
      where a.player_id = $1 order by dc.challenge_date desc limit 120`,
    [playerId],
  );
}
