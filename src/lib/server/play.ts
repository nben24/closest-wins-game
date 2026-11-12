import "server-only";
import { QUESTIONS_PER_DAY, TIMING } from "@/config/game";
import { getDb, isUniqueViolation, type Sql } from "@/lib/db";
import { parseGuess, scoreGuess, type ScoringType } from "@/lib/scoring";
import { getPlayableChallenge, today, type ChallengeRow } from "@/lib/server/challenges";
import { now as serverNow } from "@/lib/server/clock";
import { ApiError } from "@/lib/server/errors";

/**
 * Authoritative round lifecycle.
 *
 *   begin(position)  → server stamps reading_started_at = now,
 *                      answer_opens_at = now + 4s, deadline_at = now + 14s.
 *                      Calling begin again (refresh, second tab) returns the
 *                      SAME round — time is never reset.
 *   submit(position) → accepted if answer_opens_at − 0.3s ≤ now ≤ deadline + 1.5s.
 *                      Scored on the server from the published snapshot.
 *                      Idempotent: a finalized round returns its stored result.
 *   expiry           → any open round past deadline + grace is finalized as
 *                      timed_out (0 points) whenever state is read.
 *
 * Every mutation runs in a transaction holding a row lock on the attempt, so
 * concurrent requests from multiple tabs serialize.
 */

export type RoundStatus = "open" | "answered" | "no_answer" | "timed_out";

export interface QuestionView {
  position: number;
  prompt: string;
  unit: string;
  category: string;
  scoringType: ScoringType;
  allowDecimal: boolean;
  allowNegative: boolean;
}

export interface Reveal {
  guess: number | null;
  answer: number;
  score: number;
  explanation: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  referencePeriod: string | null;
  tolerance: number;
  voided: boolean;
  voidedReason: string | null;
}

export interface RoundView extends QuestionView {
  status: RoundStatus;
  readingStartedAt: string;
  answerOpensAt: string;
  deadlineAt: string;
  reveal: Reveal | null;
}

export interface PlayState {
  serverNow: string;
  timing: typeof TIMING;
  challenge: { id: string; date: string; number: number; isDemo: boolean } | null;
  attempt: { status: "in_progress" | "completed"; totalScore: number; roundsFinished: number } | null;
  rounds: RoundView[];
  /** Position the player may begin next, or null if a round is open / all done. */
  nextPosition: number | null;
  /** Category teaser for the next position (prompt is not revealed until begin). */
  nextCategory: string | null;
}

interface AttemptRow {
  id: string;
  player_id: string;
  challenge_id: string;
  status: "in_progress" | "completed";
  total_score: number;
  rounds_finished: number;
}

interface SnapshotRow {
  position: number;
  prompt: string;
  answer: number;
  unit: string;
  category: string;
  scoring_type: ScoringType;
  tolerance: number;
  allow_decimal: boolean;
  allow_negative: boolean;
  explanation: string;
  source_url: string | null;
  source_title: string | null;
  reference_period: string | null;
  voided: boolean;
  voided_reason: string | null;
}

interface RoundRow {
  id: string;
  position: number;
  reading_started_at: Date;
  answer_opens_at: Date;
  deadline_at: Date;
  status: RoundStatus;
  guess: number | null;
  score: number | null;
}

async function snapshots(sql: Sql, challengeId: string): Promise<Map<number, SnapshotRow>> {
  const rows = await sql.query<SnapshotRow>(
    `select position, prompt, answer, unit, category, scoring_type, tolerance, allow_decimal, allow_negative,
            explanation, source_url, source_title, reference_period, voided, voided_reason
       from challenge_questions where challenge_id = $1 order by position`,
    [challengeId],
  );
  return new Map(rows.map((r) => [r.position, r]));
}

function questionView(s: SnapshotRow): QuestionView {
  return {
    position: s.position,
    prompt: s.prompt,
    unit: s.unit,
    category: s.category,
    scoringType: s.scoring_type,
    allowDecimal: s.allow_decimal,
    allowNegative: s.allow_negative,
  };
}

function roundView(r: RoundRow, s: SnapshotRow): RoundView {
  const finalized = r.status !== "open";
  return {
    ...questionView(s),
    status: r.status,
    readingStartedAt: r.reading_started_at.toISOString(),
    answerOpensAt: r.answer_opens_at.toISOString(),
    deadlineAt: r.deadline_at.toISOString(),
    // Answers, explanations and sources are only included once the round is final.
    reveal: finalized
      ? {
          guess: r.status === "answered" ? r.guess : null,
          answer: s.answer,
          score: s.voided ? 0 : (r.score ?? 0),
          explanation: s.explanation,
          sourceUrl: s.source_url,
          sourceTitle: s.source_title,
          referencePeriod: s.reference_period,
          tolerance: s.tolerance,
          voided: s.voided,
          voidedReason: s.voided_reason,
        }
      : null,
  };
}

/** Recompute aggregates from rounds (voided questions contribute 0). */
export async function recomputeAttempt(sql: Sql, attemptId: string, at: Date): Promise<void> {
  await sql.query(
    `with s as (
       select count(*) filter (where r.status <> 'open')::int as n,
              coalesce(sum(r.score) filter (where r.status <> 'open' and not cq.voided), 0)::int as total
         from rounds r
         join attempts a on a.id = r.attempt_id
         join challenge_questions cq on cq.challenge_id = a.challenge_id and cq.position = r.position
        where r.attempt_id = $1)
     update attempts set rounds_finished = s.n, total_score = s.total,
            status = case when s.n >= ${QUESTIONS_PER_DAY} then 'completed' else 'in_progress' end,
            completed_at = case when s.n >= ${QUESTIONS_PER_DAY} then coalesce(attempts.completed_at, $2) else null end
       from s where attempts.id = $1`,
    [attemptId, at],
  );
}

async function finalizeExpired(sql: Sql, attemptId: string, at: Date): Promise<number> {
  const rows = await sql.query(
    `update rounds set status = 'timed_out', score = 0, finalized_at = $2
      where attempt_id = $1 and status = 'open' and deadline_at + make_interval(secs => $3) < $2
      returning id`,
    [attemptId, at, TIMING.submitGraceMs / 1000],
  );
  if (rows.length) await recomputeAttempt(sql, attemptId, at);
  return rows.length;
}

async function lockAttempt(sql: Sql, playerId: string, challengeId: string): Promise<AttemptRow | null> {
  return sql.one<AttemptRow>("select * from attempts where player_id = $1 and challenge_id = $2 for update", [
    playerId,
    challengeId,
  ]);
}

async function buildState(sql: Sql, ch: ChallengeRow, attempt: AttemptRow | null, at: Date): Promise<PlayState> {
  const snaps = await snapshots(sql, ch.id);
  const rounds = attempt
    ? await sql.query<RoundRow>(
        "select id, position, reading_started_at, answer_opens_at, deadline_at, status, guess, score from rounds where attempt_id = $1 order by position",
        [attempt.id],
      )
    : [];
  const views = rounds.map((r) => roundView(r, snaps.get(r.position)!));
  const open = rounds.some((r) => r.status === "open");
  const finished = rounds.filter((r) => r.status !== "open").length;
  const nextPosition = !open && finished < QUESTIONS_PER_DAY ? finished + 1 : null;
  return {
    serverNow: at.toISOString(),
    timing: TIMING,
    challenge: { id: ch.id, date: ch.challenge_date, number: ch.number, isDemo: ch.is_demo },
    attempt: attempt
      ? { status: attempt.status, totalScore: attempt.total_score, roundsFinished: attempt.rounds_finished }
      : null,
    rounds: views,
    nextPosition,
    nextCategory: nextPosition ? (snaps.get(nextPosition)?.category ?? null) : null,
  };
}

function emptyState(at: Date): PlayState {
  return { serverNow: at.toISOString(), timing: TIMING, challenge: null, attempt: null, rounds: [], nextPosition: null, nextCategory: null };
}

/** Current state for today's challenge (finalizes expired rounds first). */
export async function getPlayState(playerId: string): Promise<PlayState> {
  const at = serverNow();
  const ch = await getPlayableChallenge(today());
  if (!ch) return emptyState(at);
  const db = await getDb();
  return db.tx(async (sql) => {
    const attempt = await lockAttempt(sql, playerId, ch.id);
    if (attempt) await finalizeExpired(sql, attempt.id, at);
    const fresh = attempt ? await lockAttempt(sql, playerId, ch.id) : null;
    return buildState(sql, ch, fresh, at);
  });
}

/** Start (or resume) the round at `position`. Never resets an existing round. */
export async function beginRound(playerId: string, challengeId: string, position: number): Promise<PlayState> {
  const at = serverNow();
  if (!Number.isInteger(position) || position < 1 || position > QUESTIONS_PER_DAY) {
    throw new ApiError(400, "invalid_position", "Invalid question number.");
  }
  const ch = await getPlayableChallenge(today());
  if (!ch || ch.id !== challengeId) {
    throw new ApiError(409, "challenge_changed", "A new daily challenge has started. Refresh to play it.");
  }
  const db = await getDb();
  try {
    return await db.tx(async (sql) => {
      await sql.query(
        "insert into attempts (player_id, challenge_id, started_at) values ($1, $2, $3) on conflict (player_id, challenge_id) do nothing",
        [playerId, ch.id, at],
      );
      const attempt = (await lockAttempt(sql, playerId, ch.id))!;
      await finalizeExpired(sql, attempt.id, at);
      const rounds = await sql.query<RoundRow>("select position, status from rounds where attempt_id = $1", [attempt.id]);
      const open = rounds.find((r) => r.status === "open");
      if (open) {
        // Resume: return the existing round with its original deadline.
        return buildState(sql, ch, (await lockAttempt(sql, playerId, ch.id))!, at);
      }
      const existing = rounds.find((r) => r.position === position);
      if (existing) return buildState(sql, ch, (await lockAttempt(sql, playerId, ch.id))!, at);
      const expected = rounds.length + 1;
      if (position !== expected) {
        throw new ApiError(409, "out_of_order", "Questions must be played in order.");
      }
      const opens = new Date(at.getTime() + TIMING.readingMs);
      const deadline = new Date(opens.getTime() + TIMING.answerMs);
      await sql.query(
        `insert into rounds (attempt_id, position, reading_started_at, answer_opens_at, deadline_at)
         values ($1, $2, $3, $4, $5)`,
        [attempt.id, position, at, opens, deadline],
      );
      return buildState(sql, ch, (await lockAttempt(sql, playerId, ch.id))!, at);
    });
  } catch (e) {
    if (isUniqueViolation(e)) return getPlayState(playerId);
    throw e;
  }
}

export interface SubmitResult {
  state: PlayState;
  round: RoundView;
  /** true when this request did not change anything (already finalized). */
  duplicate: boolean;
  /** true when the submission arrived after the deadline + grace. */
  late: boolean;
}

export async function submitRound(
  playerId: string,
  challengeId: string,
  position: number,
  rawGuess: unknown,
  submissionId: string | null,
): Promise<SubmitResult> {
  const at = serverNow();
  const ch = await getPlayableChallenge(today());
  if (!ch || ch.id !== challengeId) {
    // The challenge rolled over at midnight. Look up the original instead so a
    // submission made just before midnight is still handled.
    const db = await getDb();
    const original = await db.one<ChallengeRow>("select * from daily_challenges where id = $1 and status = 'published'", [challengeId]);
    if (!original) throw new ApiError(409, "challenge_changed", "A new daily challenge has started.");
    return submitInChallenge(playerId, original, position, rawGuess, submissionId, at);
  }
  return submitInChallenge(playerId, ch, position, rawGuess, submissionId, at);
}

async function submitInChallenge(
  playerId: string,
  ch: ChallengeRow,
  position: number,
  rawGuess: unknown,
  submissionId: string | null,
  at: Date,
): Promise<SubmitResult> {
  const db = await getDb();
  return db.tx(async (sql) => {
    const attempt = await lockAttempt(sql, playerId, ch.id);
    if (!attempt) throw new ApiError(409, "not_started", "That question hasn't started yet.");
    const round = await sql.one<RoundRow>(
      "select id, position, reading_started_at, answer_opens_at, deadline_at, status, guess, score from rounds where attempt_id = $1 and position = $2 for update",
      [attempt.id, position],
    );
    if (!round) throw new ApiError(409, "not_started", "That question hasn't started yet.");
    const snaps = await snapshots(sql, ch.id);
    const snap = snaps.get(position)!;

    let duplicate = false;
    let late = false;
    if (round.status !== "open") {
      duplicate = true;
    } else if (at.getTime() < round.answer_opens_at.getTime() - TIMING.earlyToleranceMs) {
      throw new ApiError(409, "too_early", "Answers open after the reading time.");
    } else if (at.getTime() > round.deadline_at.getTime() + TIMING.submitGraceMs) {
      late = true;
      await sql.query("update rounds set status = 'timed_out', score = 0, finalized_at = $2 where id = $1", [round.id, at]);
      await recomputeAttempt(sql, attempt.id, at);
    } else {
      const parsed = parseGuess(rawGuess, { allowDecimal: snap.allow_decimal, allowNegative: snap.allow_negative });
      const rawText = typeof rawGuess === "string" || typeof rawGuess === "number" ? String(rawGuess).slice(0, 40) : null;
      if (parsed.ok) {
        const score = scoreGuess({ type: snap.scoring_type, tolerance: snap.tolerance }, snap.answer, parsed.value);
        await sql.query(
          `update rounds set status = 'answered', guess = $2, score = $3, raw_input = $4,
                  submitted_at = $5, finalized_at = $5, submission_id = $6 where id = $1`,
          [round.id, parsed.value, score, rawText, at, submissionId],
        );
      } else {
        await sql.query(
          `update rounds set status = 'no_answer', score = 0, raw_input = $2, submitted_at = $3, finalized_at = $3,
                  submission_id = $4 where id = $1`,
          [round.id, rawText, at, submissionId],
        );
      }
      await recomputeAttempt(sql, attempt.id, at);
    }
    const fresh = (await lockAttempt(sql, playerId, ch.id))!;
    const state = await buildState(sql, ch, fresh, at);
    return { state, round: state.rounds.find((r) => r.position === position)!, duplicate, late };
  });
}
