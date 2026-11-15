import "server-only";
import { getDb } from "@/lib/db";
import { formatNickname } from "@/lib/names";
import type { ScoringType } from "@/lib/scoring";

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
    await db.query<{ position: number; prompt: string; answer: number; unit: string; category: string; scoring_type: ScoringType; voided: boolean }>(
      "select position, prompt, answer, unit, category, scoring_type, voided from challenge_questions where challenge_id = $1 order by position",
      [ch.id],
    )
  ).map((q) => ({ position: q.position, prompt: q.prompt, answer: Number(q.answer), unit: q.unit, category: q.category, scoringType: q.scoring_type, voided: q.voided }));

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
