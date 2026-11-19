import { formatNumber } from "@/lib/format";
import { errorDistance, scoreGuess, type ScoringType } from "@/lib/scoring";

/**
 * Highlights for the "everyone's guesses" view: who was closest and whose
 * guess was furthest off. Pure, so it runs the same on server and client.
 */

/** "Half points or better". */
export const HALF_POINTS = 500;
/**
 * A wildest guess is only called out if it earned almost nothing: under this
 * many points. That scales with each question's own scoring, so on a strict
 * question you still need to be about 2× (or ~13 years) off to be named.
 * Checked against the live data to 2026-11-18: 40 of 40 questions qualified.
 */
export const WILD_MAX_SCORE = 50;

export interface PlayerGuess {
  playerId: string;
  name: string;
  avatarId: string;
  /** null = no answer / timed out */
  guess: number | null;
  score: number;
  isViewer: boolean;
}

/** How far a guess is from the answer in the question's own terms (Infinity for a 0 on a ratio question). */
function miss(type: ScoringType, answer: number, guess: number): number {
  return errorDistance(type, answer, guess) ?? Infinity;
}

function answered(guesses: PlayerGuess[]): (PlayerGuess & { guess: number })[] {
  return guesses.filter((g): g is PlayerGuess & { guess: number } => g.guess !== null && Number.isFinite(g.guess));
}

/** Everyone tied for the smallest miss (empty when nobody answered). */
export function closestGuesses(type: ScoringType, answer: number, guesses: PlayerGuess[]): PlayerGuess[] {
  const a = answered(guesses);
  if (!a.length) return [];
  const best = Math.min(...a.map((g) => miss(type, answer, g.guess)));
  return a.filter((g) => Math.abs(miss(type, answer, g.guess) - best) <= 1e-12);
}

/**
 * Everyone tied for the furthest-off guess, or [] when there are fewer than
 * 3 answers or the furthest guess is also the closest (everyone agreed).
 */
export function wildestGuesses(type: ScoringType, answer: number, guesses: PlayerGuess[]): PlayerGuess[] {
  const a = answered(guesses);
  if (a.length < 3) return [];
  const worst = Math.max(...a.map((g) => miss(type, answer, g.guess)));
  const best = Math.min(...a.map((g) => miss(type, answer, g.guess)));
  if (!(worst - best > 1e-12)) return [];
  return a.filter((g) => miss(type, answer, g.guess) === worst || Math.abs(miss(type, answer, g.guess) - worst) <= 1e-12);
}

/** The single furthest-off guess (first of any tie), or null. */
export function wildestGuess(type: ScoringType, answer: number, guesses: PlayerGuess[]): PlayerGuess | null {
  return wildestGuesses(type, answer, guesses)[0] ?? null;
}

/** Is this guess off by enough to name someone "wildest"? (It earned almost nothing.) */
export function isReallyOff(config: { type: ScoringType; tolerance: number }, answer: number, guess: number): boolean {
  return scoreGuess(config, answer, guess) < WILD_MAX_SCORE;
}

/** "13× too low", "74 years early", "6 points high", "exact". */
export function missNote(type: ScoringType, answer: number, guess: number): string {
  const d = guess - answer;
  if (Math.abs(d) <= 1e-9 * Math.max(1, Math.abs(answer))) return "exact";
  if (type === "year") {
    const n = Math.round(Math.abs(d));
    return `${formatNumber(n)} year${n === 1 ? "" : "s"} ${d < 0 ? "early" : "late"}`;
  }
  if (type === "percent") return `${formatNumber(Math.abs(d), 1)} point${Math.abs(d) === 1 ? "" : "s"} ${d < 0 ? "low" : "high"}`;
  if (type === "ratio" && answer > 0 && guess > 0) {
    const r = guess / answer;
    const f = r >= 1 ? r : 1 / r;
    if (f >= 1.95) return `${formatNumber(Math.round(f))}× too ${r >= 1 ? "high" : "low"}`;
    return `${Math.round((f - 1) * 100)}% too ${r >= 1 ? "high" : "low"}`;
  }
  return `${formatNumber(Math.abs(d), 2)} too ${d < 0 ? "low" : "high"}`;
}
