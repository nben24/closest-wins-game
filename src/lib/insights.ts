import { errorDistance, type ScoringConfig } from "@/lib/scoring";

/**
 * Group insights computed only from real, submitted guesses. Blank and timed
 * out answers are excluded. Small samples produce fewer (or no) insights; we
 * never fabricate statistics.
 */

export interface GuessPoint {
  playerId: string;
  name: string;
  avatarId: string;
  guess: number;
  isViewer: boolean;
}

export interface NumberLinePoint extends GuessPoint {
  /** 0..1 along the line */
  x: number;
  /** true when the guess is beyond the displayed range and pinned to an edge */
  clamped: "low" | "high" | null;
}

export interface NumberLine {
  scale: "linear" | "log";
  min: number;
  max: number;
  answerX: number;
  points: NumberLinePoint[];
}

export const MIN_PLAYERS_FOR_DIRECTION_INSIGHT = 3;

export function buildNumberLine(config: ScoringConfig, answer: number, guesses: GuessPoint[]): NumberLine | null {
  const finite = guesses.filter((g) => Number.isFinite(g.guess));
  if (finite.length === 0 || !Number.isFinite(answer)) return null;
  const useLog = config.type === "ratio" && answer > 0;

  if (useLog) {
    // Range: at most 25× either side of the answer; outliers are pinned.
    const span = Math.log(25);
    const logs = finite.filter((g) => g.guess > 0).map((g) => Math.log(g.guess));
    const la = Math.log(answer);
    const lo = Math.max(la - span, Math.min(la - Math.log(1.5), ...logs));
    const hi = Math.min(la + span, Math.max(la + Math.log(1.5), ...logs));
    const toX = (v: number) => (v - lo) / (hi - lo);
    return {
      scale: "log",
      min: Math.exp(lo),
      max: Math.exp(hi),
      answerX: toX(la),
      points: finite.map((g) => {
        if (g.guess <= 0) return { ...g, x: 0, clamped: "low" as const };
        const l = Math.log(g.guess);
        if (l < lo) return { ...g, x: 0, clamped: "low" as const };
        if (l > hi) return { ...g, x: 1, clamped: "high" as const };
        return { ...g, x: toX(l), clamped: null };
      }),
    };
  }

  const t = Math.max(config.tolerance, 1e-9);
  const values = finite.map((g) => g.guess);
  const lo = Math.max(answer - 5 * t, Math.min(answer - t, ...values));
  const hi = Math.min(answer + 5 * t, Math.max(answer + t, ...values));
  const toX = (v: number) => (v - lo) / (hi - lo);
  return {
    scale: "linear",
    min: lo,
    max: hi,
    answerX: toX(answer),
    points: finite.map((g) => {
      if (g.guess < lo) return { ...g, x: 0, clamped: "low" as const };
      if (g.guess > hi) return { ...g, x: 1, clamped: "high" as const };
      return { ...g, x: toX(g.guess), clamped: null };
    }),
  };
}

export interface QuestionInsight {
  closestNames: string[];
  viewerIsClosest: boolean;
  direction: "all_high" | "all_low" | null;
  submittedCount: number;
}

export function questionInsight(config: ScoringConfig, answer: number, guesses: GuessPoint[]): QuestionInsight {
  const scored = guesses
    .map((g) => ({ g, e: errorDistance(config.type, answer, g.guess) }))
    .filter((x): x is { g: GuessPoint; e: number } => x.e !== null);
  let closestNames: string[] = [];
  let viewerIsClosest = false;
  if (scored.length >= 2) {
    const best = Math.min(...scored.map((x) => x.e));
    const tied = scored.filter((x) => Math.abs(x.e - best) <= 1e-12);
    closestNames = tied.map((x) => (x.g.isViewer ? "You" : x.g.name));
    viewerIsClosest = tied.some((x) => x.g.isViewer);
  }
  let direction: QuestionInsight["direction"] = null;
  if (guesses.length >= MIN_PLAYERS_FOR_DIRECTION_INSIGHT) {
    if (guesses.every((g) => g.guess > answer)) direction = "all_high";
    else if (guesses.every((g) => g.guess < answer)) direction = "all_low";
  }
  return { closestNames, viewerIsClosest, direction, submittedCount: guesses.length };
}
