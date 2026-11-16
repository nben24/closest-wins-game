import "server-only";
import { getDb } from "@/lib/db";
import { formatNickname } from "@/lib/names";
import { scoreGuess, type ScoringType } from "@/lib/scoring";

/**
 * Admin-only: every player's guess for every question on one day. Contains
 * answers and raw guesses, so it must only ever be rendered behind the admin
 * check (src/app/admin/(panel)/layout.tsx) — never from a player API.
 */

export interface AnswerQuestion {
  position: number;
  prompt: string;
  answer: number;
  unit: string;
  category: string;
  scoringType: ScoringType;
  tolerance: number;
  difficulty: string;
  voided: boolean;
}

export interface AnswerRound {
  position: number;
  status: "open" | "answered" | "no_answer" | "timed_out";
  guess: number | null;
  score: number | null;
  /** Seconds from the answer window opening to the guess being locked in. */
  secondsToAnswer: number | null;
}

export interface AnswerPlayer {
  playerId: string;
  name: string;
  avatarId: string;
  status: "in_progress" | "completed";
  total: number;
  roundsFinished: number;
  startedAt: string;
  rounds: Record<number, AnswerRound>;
}

export interface DayAnswers {
  date: string;
  challenge: { id: string; number: number; isDemo: boolean } | null;
  questions: AnswerQuestion[];
  players: AnswerPlayer[];
}

export async function dayAnswers(date: string): Promise<DayAnswers> {
  const db = await getDb();
  const ch = await db.one<{ id: string; number: number; is_demo: boolean }>(
    "select id, number, is_demo from daily_challenges where challenge_date = $1 and status = 'published'",
    [date],
  );
  if (!ch) return { date, challenge: null, questions: [], players: [] };

  const questions = (
    await db.query<{
      position: number; prompt: string; answer: number; unit: string; category: string; scoring_type: ScoringType; tolerance: number; difficulty: string; voided: boolean;
    }>(
      "select position, prompt, answer, unit, category, scoring_type, tolerance, difficulty, voided from challenge_questions where challenge_id = $1 order by position",
      [ch.id],
    )
  ).map((q) => ({
    position: q.position, prompt: q.prompt, answer: Number(q.answer), unit: q.unit, category: q.category,
    scoringType: q.scoring_type, tolerance: Number(q.tolerance), difficulty: q.difficulty, voided: q.voided,
  }));

  const attempts = await db.query<{
    id: string; player_id: string; status: "in_progress" | "completed"; total_score: number; rounds_finished: number; started_at: Date;
    avatar_id: string; name_adjective: string; name_noun: string; name_suffix: number | null;
  }>(
    `select a.id, a.player_id, a.status, a.total_score, a.rounds_finished, a.started_at,
            p.avatar_id, p.name_adjective, p.name_noun, p.name_suffix
       from attempts a join players p on p.id = a.player_id
      where a.challenge_id = $1
      order by (a.status = 'completed') desc, a.total_score desc, a.started_at`,
    [ch.id],
  );

  const rounds = await db.query<{
    attempt_id: string; position: number; status: AnswerRound["status"]; guess: number | null; score: number | null;
    answer_opens_at: Date; submitted_at: Date | null;
  }>(
    `select r.attempt_id, r.position, r.status, r.guess, r.score, r.answer_opens_at, r.submitted_at
       from rounds r join attempts a on a.id = r.attempt_id
      where a.challenge_id = $1`,
    [ch.id],
  );
  const byAttempt = new Map<string, Record<number, AnswerRound>>();
  for (const r of rounds) {
    const m = byAttempt.get(r.attempt_id) ?? {};
    m[r.position] = {
      position: r.position,
      status: r.status,
      guess: r.guess === null ? null : Number(r.guess),
      score: r.score,
      secondsToAnswer:
        r.status === "answered" && r.submitted_at ? Math.max(0, (new Date(r.submitted_at).getTime() - new Date(r.answer_opens_at).getTime()) / 1000) : null,
    };
    byAttempt.set(r.attempt_id, m);
  }

  return {
    date,
    challenge: { id: ch.id, number: ch.number, isDemo: ch.is_demo },
    questions,
    players: attempts.map((a) => ({
      playerId: a.player_id,
      name: formatNickname(a.name_adjective, a.name_noun, a.name_suffix),
      avatarId: a.avatar_id,
      status: a.status,
      total: a.total_score,
      roundsFinished: a.rounds_finished,
      startedAt: new Date(a.started_at).toISOString(),
      rounds: byAttempt.get(a.id) ?? {},
    })),
  };
}

export type QuestionFlag = { key: "too_easy" | "too_strict" | "lost"; label: string; hint: string };

/**
 * Quality flags from how people actually played a question (needs 5+ answers):
 *  - too easy: 40%+ got it exactly
 *  - 50%+ scored under 100 → either "too strict" (the typical guess was
 *    reasonable, the tolerance wasn't) or "everyone was lost" (guesses were
 *    all over the place: the question had no way in).
 */
export function questionFlags(q: AnswerQuestion, rounds: AnswerRound[]): QuestionFlag[] {
  const played = rounds.filter((r) => r.status !== "open");
  const answered = played.filter((r) => r.status === "answered" && r.guess !== null);
  if (answered.length < 5) return [];
  const flags: QuestionFlag[] = [];
  const exact = answered.filter((r) => r.score === 1000).length / answered.length;
  if (exact >= 0.4) flags.push({ key: "too_easy", label: "Too easy", hint: `${Math.round(exact * 100)}% got it exactly` });
  const low = played.filter((r) => (r.score ?? 0) < 100).length / played.length;
  if (low >= 0.5) {
    const sorted = answered.map((r) => r.guess!).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const medianScore = scoreGuess({ type: q.scoringType, tolerance: q.tolerance }, q.answer, median);
    flags.push(
      medianScore >= 300
        ? { key: "too_strict", label: "Too strict", hint: `${Math.round(low * 100)}% scored under 100, but the typical guess was reasonable` }
        : { key: "lost", label: "Everyone was lost", hint: `${Math.round(low * 100)}% scored under 100 and guesses were all over the place` },
    );
  }
  return flags;
}
