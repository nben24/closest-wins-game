import { WEEKLY_COUNTED_DAYS } from "@/config/game";

/**
 * Standard competition ranking ("1, 1, 3"): equal scores share a rank and the
 * next rank skips. Ties are never broken by speed. Order within a tie is by
 * the provided tiebreak key purely for stable display.
 */
export function rankByScore<T>(
  items: T[],
  score: (t: T) => number,
  displayOrder: (t: T) => string = () => "",
): (T & { rank: number })[] {
  const sorted = [...items].sort((a, b) => score(b) - score(a) || displayOrder(a).localeCompare(displayOrder(b)));
  let lastScore: number | null = null;
  let lastRank = 0;
  return sorted.map((item, i) => {
    const s = score(item);
    const rank = lastScore !== null && s === lastScore ? lastRank : i + 1;
    lastScore = s;
    lastRank = rank;
    return { ...item, rank };
  });
}

/** Sum of a player's best N daily scores in a week. */
export function weeklyTotal(dailyScores: number[], counted = WEEKLY_COUNTED_DAYS): {
  total: number;
  daysPlayed: number;
  daysCounted: number;
} {
  const best = [...dailyScores].sort((a, b) => b - a).slice(0, counted);
  return {
    total: best.reduce((s, x) => s + x, 0),
    daysPlayed: dailyScores.length,
    daysCounted: best.length,
  };
}
