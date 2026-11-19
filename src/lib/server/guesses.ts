import "server-only";
import { getDb } from "@/lib/db";
import { formatNickname } from "@/lib/names";
import { closestGuesses, HALF_POINTS, isReallyOff, wildestGuesses, type PlayerGuess } from "@/lib/guess-summary";
import type { ScoringType } from "@/lib/scoring";

/**
 * Everyone's guesses for one day: the spread of guesses as ANONYMOUS dots,
 * plus a few named highlights (closest and the wildest miss). The full list
 * of who guessed what is never sent, so it can't be dug out of the browser.
 *
 * Guesses give the answers away, so this only returns data to a player who
 * has COMPLETED that day's challenge (they've seen every answer by then).
 * Anyone else gets `locked: true` and no questions, answers or guesses.
 * Only completed attempts count; players still mid-game are left out.
 */

export interface GuessDot {
  guess: number;
  score: number;
  isViewer: boolean;
}

export interface Highlight {
  name: string;
  avatarId: string;
  guess: number;
  isViewer: boolean;
}

export interface QuestionGuesses {
  position: number;
  prompt: string;
  unit: string;
  scoringType: ScoringType;
  tolerance: number;
  answer: number;
  voided: boolean;
  /** Every submitted guess, no names, sorted by value. */
  dots: GuessDot[];
  /** Players who finished, including no-answers. */
  finished: number;
  noAnswer: number;
  halfOrBetter: number;
  median: number | null;
  tooLow: number;
  tooHigh: number;
  /** Everyone tied for closest (at most 3 named; see closestCount). */
  closest: Highlight[];
  closestCount: number;
  /** The furthest-off guess, only when it's a genuinely big miss (see isReallyOff). */
  wildest: Highlight | null;
  /** Others exactly as far off as `wildest` (shown as "+ N other"). */
  wildestOthers: number;
  mine: { guess: number | null; score: number } | null;
}

export interface DayGuesses {
  date: string;
  number: number | null;
  locked: boolean;
  /** Players who finished (shown even when locked). */
  players: number;
  questions: QuestionGuesses[];
}

const highlight = (g: PlayerGuess): Highlight => ({ name: g.name, avatarId: g.avatarId, guess: g.guess!, isViewer: g.isViewer });

function medianOf(values: number[]): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export async function dayGuesses(viewerId: string, date: string): Promise<DayGuesses> {
  const db = await getDb();
  const ch = await db.one<{ id: string; number: number }>(
    "select id, number from daily_challenges where challenge_date = $1 and status = 'published'",
    [date],
  );
  if (!ch) return { date, number: null, locked: true, players: 0, questions: [] };

  const count = await db.one<{ n: number }>("select count(*)::int as n from attempts where challenge_id = $1 and status = 'completed'", [ch.id]);
  const mine = await db.one<{ status: string }>("select status from attempts where challenge_id = $1 and player_id = $2", [ch.id, viewerId]);
  if (mine?.status !== "completed") {
    return { date, number: ch.number, locked: true, players: count?.n ?? 0, questions: [] };
  }

  const people = await db.query<{
    player_id: string; avatar_id: string; name_adjective: string; name_noun: string; name_suffix: number | null;
  }>(
    `select a.player_id, p.avatar_id, p.name_adjective, p.name_noun, p.name_suffix
       from attempts a join players p on p.id = a.player_id
      where a.challenge_id = $1 and a.status = 'completed'`,
    [ch.id],
  );
  const who = new Map(
    people.map((p) => [p.player_id, { name: formatNickname(p.name_adjective, p.name_noun, p.name_suffix), avatarId: p.avatar_id }]),
  );
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
    const type = s.scoring_type;
    const answer = Number(s.answer);
    const tolerance = Number(s.tolerance);
    const all: PlayerGuess[] = rounds
      .filter((r) => r.position === s.position && who.has(r.player_id))
      .map((r) => ({
        playerId: r.player_id,
        ...who.get(r.player_id)!,
        guess: r.status === "answered" && r.guess !== null ? Number(r.guess) : null,
        score: s.voided ? 0 : Number(r.score ?? 0),
        isViewer: r.player_id === viewerId,
      }));
    const answered = all.filter((g) => g.guess !== null) as (PlayerGuess & { guess: number })[];
    const closestAll = s.voided ? [] : closestGuesses(type, answer, all);
    // Sort ties so the viewer is named first if they're among them.
    closestAll.sort((a, b) => Number(b.isViewer) - Number(a.isViewer) || a.name.localeCompare(b.name));
    const wildAll = s.voided ? [] : wildestGuesses(type, answer, all);
    wildAll.sort((a, b) => Number(b.isViewer) - Number(a.isViewer) || a.name.localeCompare(b.name));
    const wild = wildAll.length && isReallyOff({ type, tolerance }, answer, wildAll[0].guess!) ? wildAll : [];
    const me = all.find((g) => g.isViewer);
    return {
      position: s.position,
      prompt: s.prompt,
      unit: s.unit,
      scoringType: type,
      tolerance,
      answer,
      voided: s.voided,
      dots: answered.map((g) => ({ guess: g.guess, score: g.score, isViewer: g.isViewer })).sort((a, b) => a.guess - b.guess),
      finished: all.length,
      noAnswer: all.length - answered.length,
      halfOrBetter: s.voided ? 0 : all.filter((g) => g.score >= HALF_POINTS).length,
      median: medianOf(answered.map((g) => g.guess)),
      tooLow: answered.filter((g) => g.guess < answer).length,
      tooHigh: answered.filter((g) => g.guess > answer).length,
      closest: closestAll.slice(0, 3).map(highlight),
      closestCount: closestAll.length,
      wildest: wild.length ? highlight(wild[0]) : null,
      wildestOthers: Math.max(0, wild.length - 1),
      mine: me ? { guess: me.guess, score: me.score } : null,
    };
  });

  return { date, number: ch.number, locked: false, players: people.length, questions };
}
