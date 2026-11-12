/**
 * Scoring — accuracy only, never speed.
 *
 * Every question has a scoring type and a tolerance `t`. We compute an error
 * distance `e` (meaning depends on the type) and award:
 *
 *     points = 1000 × 2^(−(e / t)^1.5)
 *
 * so the tolerance is the "half-points distance": being exactly `t` away earns
 * 500. A few reference points for any type:
 *
 *     e = 0      → 1000 (exact; the only way to get 1000)
 *     e = 0.25t  → 917
 *     e = 0.5t   → 783
 *     e = t      → 500
 *     e = 2t     → 141
 *     e = 3t     → 27
 *     e ≥ ~4t    → 0–3
 *
 * Types and their error distance:
 *
 *  - ratio    e = |ln(guess / answer)|, t = ln(factor). For positive quantities
 *             spanning large scales. Symmetric: guessing 2× too high is as good
 *             as guessing 2× too low. Unit-invariant (minutes vs hours scales the
 *             same way). A guess ≤ 0 earns 0. Tolerance is entered as a factor,
 *             e.g. 1.5 → "half points when off by ×1.5".
 *  - absolute e = |guess − answer| in the question's unit. Use for small values,
 *             values that can be zero or negative (temperatures), and anything
 *             where ratios make no sense.
 *  - year     e = |guess − answer| in years. A year is a date, not a quantity, so
 *             2000 vs 2010 is a 10-year miss (not a 0.5% miss).
 *  - percent  e = |guess − answer| in percentage points (answer within 0–100).
 *
 * The result is always an integer in [0, 1000]; NaN/Infinity cannot escape.
 */

export const SCORING_TYPES = ["ratio", "absolute", "year", "percent"] as const;
export type ScoringType = (typeof SCORING_TYPES)[number];

export interface ScoringConfig {
  type: ScoringType;
  /** ratio: factor > 1 (e.g. 1.5). Others: half-points distance in units. */
  tolerance: number;
}

export interface InputConfig {
  allowDecimal: boolean;
  allowNegative: boolean;
}

/** Curve steepness. Larger = flatter near the answer and steeper further out. */
export const SCORING_SHAPE = 1.5;
export const MAX_SCORE = 1000;
/** Largest magnitude any guess may have. */
export const MAX_GUESS_ABS = 1e15;
export const MAX_GUESS_DECIMALS = 6;

export const DEFAULT_TOLERANCE: Record<ScoringType, number> = {
  ratio: 1.5,
  absolute: 10,
  year: 5,
  percent: 8,
};

export const TOLERANCE_LIMITS: Record<ScoringType, { min: number; max: number }> = {
  ratio: { min: 1.05, max: 10 },
  absolute: { min: 0.0001, max: 1e12 },
  year: { min: 0.5, max: 100 },
  percent: { min: 0.5, max: 50 },
};

function isExact(answer: number, guess: number): boolean {
  return Math.abs(guess - answer) <= 1e-9 * Math.max(1, Math.abs(answer));
}

/**
 * Error distance in the type's natural unit, or null when the guess can never
 * score (e.g. non-positive guess for a ratio question).
 */
export function errorDistance(type: ScoringType, answer: number, guess: number): number | null {
  if (!Number.isFinite(answer) || !Number.isFinite(guess)) return null;
  if (type === "ratio") {
    if (!(answer > 0) || !(guess > 0)) return null;
    return Math.abs(Math.log(guess / answer));
  }
  return Math.abs(guess - answer);
}

/** Distance at which a guess earns half points, in the same unit as errorDistance. */
export function halfPointDistance(config: ScoringConfig): number | null {
  const t = config.tolerance;
  if (!Number.isFinite(t)) return null;
  if (config.type === "ratio") return t > 1 ? Math.log(t) : null;
  return t > 0 ? t : null;
}

/** Points for a guess. Guaranteed integer in [0, 1000]. */
export function scoreGuess(config: ScoringConfig, answer: number, guess: number | null): number {
  if (guess === null || !Number.isFinite(guess) || !Number.isFinite(answer)) return 0;
  if (config.type === "ratio" && !(answer > 0 && guess > 0)) return 0;
  if (halfPointDistance(config) === null) return 0;
  if (isExact(answer, guess)) return MAX_SCORE;
  const e = errorDistance(config.type, answer, guess);
  const t = halfPointDistance(config);
  if (e === null || t === null) return 0;
  const raw = MAX_SCORE * Math.pow(2, -Math.pow(e / t, SCORING_SHAPE));
  if (!Number.isFinite(raw)) return 0;
  // Only an exact answer earns the full 1000.
  const rounded = Math.min(MAX_SCORE - 1, Math.round(raw));
  return Math.max(0, rounded);
}

/** Validate a scoring setup for a given answer. Returns human-readable problems. */
export function validateScoringConfig(
  config: ScoringConfig,
  answer: number,
  input: InputConfig,
): string[] {
  const problems: string[] = [];
  if (!SCORING_TYPES.includes(config.type)) problems.push("Unknown scoring type.");
  if (!Number.isFinite(answer)) problems.push("Answer must be a finite number.");
  if (Math.abs(answer) > MAX_GUESS_ABS) problems.push("Answer is too large.");
  const lim = TOLERANCE_LIMITS[config.type];
  if (lim && (!Number.isFinite(config.tolerance) || config.tolerance < lim.min || config.tolerance > lim.max)) {
    problems.push(`Tolerance for ${config.type} must be between ${lim.min} and ${lim.max}.`);
  }
  if (config.type === "ratio" && !(answer > 0)) {
    problems.push("Ratio scoring needs a positive answer. Use absolute scoring for zero or negative answers.");
  }
  if (config.type === "year") {
    if (!Number.isInteger(answer)) problems.push("Year answers must be whole years.");
    if (answer < 0 || answer > 2100) problems.push("Year answers must be between 0 and 2100.");
    if (input.allowDecimal) problems.push("Year questions should not allow decimals.");
  }
  if (config.type === "percent" && (answer < 0 || answer > 100)) {
    problems.push("Percent answers must be between 0 and 100.");
  }
  if (answer < 0 && !input.allowNegative) {
    problems.push("Answer is negative, so negative input must be allowed.");
  }
  if (!Number.isInteger(answer) && !input.allowDecimal) {
    problems.push("Answer has decimals, so decimal input must be allowed.");
  }
  if (input.allowNegative && config.type === "ratio") {
    problems.push("Ratio questions cannot accept negative guesses.");
  }
  return problems;
}

export type GuessParse =
  | { ok: true; value: number }
  | { ok: false; reason: "blank" | "invalid" | "negative_not_allowed" | "decimal_not_allowed" | "too_large" };

/**
 * Parse a raw guess string from the client. Accepts digits with optional
 * thousands separators, one decimal point and a leading minus sign — only where
 * the question allows them. Zero is a valid guess.
 */
export function parseGuess(raw: unknown, input: InputConfig): GuessParse {
  if (raw === null || raw === undefined) return { ok: false, reason: "blank" };
  if (typeof raw !== "string" && typeof raw !== "number") return { ok: false, reason: "invalid" };
  const s = String(raw).trim().replace(/[,\s_]/g, "");
  if (s === "" || s === "-" || s === ".") return { ok: false, reason: "blank" };
  if (s.length > 40) return { ok: false, reason: "invalid" };
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(s)) return { ok: false, reason: "invalid" };
  if (s.startsWith("-") && !input.allowNegative) return { ok: false, reason: "negative_not_allowed" };
  const decimals = s.includes(".") ? s.split(".")[1].length : 0;
  if (decimals > 0 && !input.allowDecimal) return { ok: false, reason: "decimal_not_allowed" };
  if (decimals > MAX_GUESS_DECIMALS) return { ok: false, reason: "invalid" };
  const value = Number(s);
  if (!Number.isFinite(value)) return { ok: false, reason: "invalid" };
  if (Math.abs(value) > MAX_GUESS_ABS) return { ok: false, reason: "too_large" };
  return { ok: true, value: Object.is(value, -0) ? 0 : value };
}

/** Sample guesses used for admin scoring previews. */
export function previewGuesses(config: ScoringConfig, answer: number): number[] {
  const out = new Set<number>();
  const round = (n: number) => {
    if (config.type === "year") return Math.round(n);
    const mag = Math.abs(n);
    const digits = mag >= 100 ? 0 : mag >= 1 ? 2 : 4;
    return Number(n.toFixed(digits));
  };
  out.add(answer);
  if (config.type === "ratio") {
    for (const f of [1.1, 1.25, config.tolerance, 2, 5, 10]) {
      out.add(round(answer * f));
      out.add(round(answer / f));
    }
  } else {
    const t = config.tolerance;
    for (const k of [0.25, 0.5, 1, 2, 3]) {
      out.add(round(answer + k * t));
      out.add(round(answer - k * t));
    }
  }
  return [...out]
    .filter((g) => Number.isFinite(g) && (config.type !== "percent" || (g >= 0 && g <= 100)))
    .sort((a, b) => a - b);
}

/** Band labels for results. Friendly, never insulting; shape + text, not just colour. */
export interface ScoreBand {
  key: "bullseye" | "close" | "warm" | "ballpark" | "far" | "none";
  label: string;
  symbol: string;
  shareSymbol: string;
}

/** True when a round deserves the green "nailed it" treatment (a Bullseye). */
export function isHit(points: number, answered = true, voided = false): boolean {
  return scoreBand(points, answered, voided).key === "bullseye";
}

export function scoreBand(points: number, answered = true, voided = false): ScoreBand {
  if (voided) return { key: "none", label: "Not counted", symbol: "–", shareSymbol: "➖" };
  if (!answered) return { key: "none", label: "No answer", symbol: "·", shareSymbol: "⚪" };
  if (points >= 900) return { key: "bullseye", label: "Bullseye!", symbol: "◎", shareSymbol: "🎯" };
  if (points >= 700) return { key: "close", label: "So close", symbol: "●", shareSymbol: "🟢" };
  if (points >= 400) return { key: "warm", label: "Nice estimate", symbol: "◐", shareSymbol: "🟡" };
  if (points >= 100) return { key: "ballpark", label: "In the ballpark", symbol: "○", shareSymbol: "🟠" };
  return { key: "far", label: "Long shot", symbol: "◌", shareSymbol: "⚪" };
}
