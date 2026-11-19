import "server-only";
import { getDb } from "@/lib/db";
import { formatNickname } from "@/lib/names";
import type { PlayerGuess } from "@/lib/guess-summary";
import type { ScoringType } from "@/lib/scoring";

/**
 * Everyone's guesses for one day, by name.
 *
 * Guesses give the answers away (three people guessing exactly 2,722 tells
 * you the answer), so they are only returned to a player who has COMPLETED
 * that day's challenge — by which point they have seen every answer anyway.
 * Anyone else gets `locked: true` and no questions, answers or guesses.
 * Only completed attempts are included; players still mid-game are left out.
 */

export interface QuestionGuesses {
  position: number;
  prompt: string;
  unit: string;
  scoringType: ScoringType;
  tolerance: number;
  answer: number;
  voided: boolean;
  /** Best score first; no-answers last. */
  guesses: PlayerGuess[];
}

export interface StandingRow {
  playerId: string;
  name: string;
  avatarId: string;
  total: number;
  rank: number;
  isViewer: boolean;
}

export interface DayGuesses {
  date: string;
  number: number | null;
  locked: boolean;
  /** Players who finished (shown even when locked). */
  players: number;
  standings: StandingRow[];
  questions: QuestionGuesses[];
}

export async function dayGuesses(viewerId: string, date: string): Promise<DayGuesses> {
  const db = await getDb();
  const ch = await db.one<{ id: string; number: number }>(
    "select id, number from daily_challenges where challenge_date = $1 and status = 'published'",
    [date],
  );
  if (!ch) return { date, number: null, locked: true, players: 0, standings: [], questions: [] };

  const count = await db.one<{ n: number }>("select count(*)::int as n from attempts where challenge_id = $1 and status = 'completed'", [ch.id]);
  const mine = await db.one<{ status: string }>("select status from attempts where challenge_id = $1 and player_id = $2", [ch.id, viewerId]);
  if (mine?.status !== "completed") {
    return { date, number: ch.number, locked: true, players: count?.n ?? 0, standings: [], questions: [] };
  }

  const people = await db.query<{
    player_id: string; total_score: number; rank: number; avatar_id: string; name_adjective: string; name_noun: string; name_suffix: number | null;
  }>(
    `select a.player_id, a.total_score, rank() over (order by a.total_score desc)::int as rank,
            p.avatar_id, p.name_adjective, p.name_noun, p.name_suffix
       from attempts a join players p on p.id = a.player_id
      where a.challenge_id = $1 and a.status = 'completed'
      order by a.total_score desc, p.name_adjective, p.name_noun`,
    [ch.id],
  );
  const who = new Map(
    people.map((p) => [p.player_id, { name: formatNickname(p.name_adjective, p.name_noun, p.name_suffix), avatarId: p.avatar_id }]),
  );
  const standings: StandingRow[] = people.map((p) => ({
    playerId: p.player_id,
    ...who.get(p.player_id)!,
    total: Number(p.total_score),
    rank: Number(p.rank),
    isViewer: p.player_id === viewerId,
  }));

  const snaps = await db.query<{
    position: number; prompt: string; unit: string; scoring_type: ScoringType; tolerance: number; answer: number; voided: boolean;
  }>(
    "select position, prompt, unit, scoring_type, tolerance, answer, voided from challenge_questions where challenge_id = $1 order by position",
    [ch.id],
  );
  const rounds = await db.query<{ position: number; player_id: string; status: string; guess: number | null; score: number | null }>(
    `select r.position, a.player_id, r.status, r.guess, r.score
       from rounds r join attempts a on a.id = r.attempt_id
      where a.challenge_id = $1 and a.status = 'completed'`,
    [ch.id],
  );

  const questions: QuestionGuesses[] = snaps.map((s) => {
    const guesses: PlayerGuess[] = rounds
      .filter((r) => r.position === s.position && who.has(r.player_id))
      .map((r) => ({
        playerId: r.player_id,
        ...who.get(r.player_id)!,
        guess: r.status === "answered" && r.guess !== null ? Number(r.guess) : null,
        score: s.voided ? 0 : Number(r.score ?? 0),
        isViewer: r.player_id === viewerId,
      }))
      .sort((a, b) => (a.guess === null ? 1 : 0) - (b.guess === null ? 1 : 0) || b.score - a.score || a.name.localeCompare(b.name));
    return {
      position: s.position,
      prompt: s.prompt,
      unit: s.unit,
      scoringType: s.scoring_type,
      tolerance: Number(s.tolerance),
      answer: Number(s.answer),
      voided: s.voided,
      guesses,
    };
  });

  return { date, number: ch.number, locked: false, players: people.length, standings, questions };
}
