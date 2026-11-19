import { describe, expect, it } from "vitest";
import {
  parseGuess,
  previewGuesses,
  scoreGuess,
  validateScoringConfig,
  type ScoringConfig,
} from "@/lib/scoring";

const ratio: ScoringConfig = { type: "ratio", tolerance: 1.5 };
const year: ScoringConfig = { type: "year", tolerance: 5 };
const pct: ScoringConfig = { type: "percent", tolerance: 8 };
const abs: ScoringConfig = { type: "absolute", tolerance: 2 };

describe("scoreGuess", () => {
  it("awards 1000 only for exact answers", () => {
    expect(scoreGuess(ratio, 88, 88)).toBe(1000);
    expect(scoreGuess(ratio, 88, 88.01)).toBeLessThan(1000);
    expect(scoreGuess(year, 1969, 1969)).toBe(1000);
    expect(scoreGuess(abs, 0, 0)).toBe(1000);
    expect(scoreGuess(ratio, 26.2, 26.2)).toBe(1000);
  });

  it("gives half points at the tolerance distance", () => {
    expect(scoreGuess(ratio, 1000, 1500)).toBe(500);
    expect(scoreGuess(ratio, 1000, 1000 / 1.5)).toBe(500);
    expect(scoreGuess(year, 2000, 2005)).toBe(500);
    expect(scoreGuess(pct, 50, 42)).toBe(500);
  });

  it("is symmetric for ratio (2x high == 2x low)", () => {
    expect(scoreGuess(ratio, 100, 200)).toBe(scoreGuess(ratio, 100, 50));
  });

  it("decreases monotonically as error grows", () => {
    let prev = 1001;
    for (const g of [100, 101, 105, 110, 130, 150, 200, 400, 1000, 10000]) {
      const s = scoreGuess(ratio, 100, g);
      expect(s).toBeLessThanOrEqual(prev);
      prev = s;
    }
    expect(scoreGuess(ratio, 100, 10000)).toBe(0);
  });

  it("does not treat years as quantities", () => {
    // 10 years off on a year question is a big miss, not a 0.5% miss
    expect(scoreGuess(year, 2000, 2010)).toBeLessThan(200);
    expect(scoreGuess(year, 2000, 2001)).toBeGreaterThan(900);
  });

  it("is unit-invariant for ratio scoring", () => {
    expect(scoreGuess(ratio, 3, 4.5)).toBe(scoreGuess(ratio, 3000, 4500));
    expect(scoreGuess(ratio, 194, 120)).toBe(scoreGuess(ratio, 194 * 60, 120 * 60));
  });

  it("handles zero, negatives and invalid values safely", () => {
    expect(scoreGuess(ratio, 100, 0)).toBe(0);
    expect(scoreGuess(ratio, 100, -5)).toBe(0);
    expect(scoreGuess(ratio, 0, 5)).toBe(0);
    expect(scoreGuess(abs, 0, 1)).toBeGreaterThan(700);
    expect(scoreGuess({ type: "absolute", tolerance: 10 }, -40, -35)).toBeGreaterThan(600);
    expect(scoreGuess(abs, 5, null)).toBe(0);
    expect(scoreGuess(abs, 5, Number.NaN)).toBe(0);
    expect(scoreGuess(abs, 5, Number.POSITIVE_INFINITY)).toBe(0);
    expect(scoreGuess({ type: "absolute", tolerance: 0 }, 5, 4)).toBe(0);
    expect(scoreGuess({ type: "ratio", tolerance: 1 }, 5, 4)).toBe(0);
    expect(scoreGuess({ type: "ratio", tolerance: Number.NaN }, 5, 5)).toBe(0);
  });

  it("always returns an integer in [0, 1000]", () => {
    const configs: ScoringConfig[] = [ratio, year, pct, abs, { type: "ratio", tolerance: 10 }, { type: "absolute", tolerance: 1e-4 }];
    const values = [-1e15, -1e6, -1, -0.001, 0, 1e-9, 0.5, 1, 7, 99.99, 1e3, 1e9, 1e15];
    for (const c of configs) {
      for (const a of values) {
        for (const g of values) {
          const s = scoreGuess(c, a, g);
          expect(Number.isInteger(s)).toBe(true);
          expect(s).toBeGreaterThanOrEqual(0);
          expect(s).toBeLessThanOrEqual(1000);
        }
      }
    }
  });
});

describe("parseGuess", () => {
  const intOnly = { allowDecimal: false, allowNegative: false };
  const any = { allowDecimal: true, allowNegative: true };
  it("accepts zero and formatted numbers", () => {
    expect(parseGuess("0", intOnly)).toEqual({ ok: true, value: 0 });
    expect(parseGuess("1,234,567", intOnly)).toEqual({ ok: true, value: 1234567 });
    expect(parseGuess("-0", any)).toEqual({ ok: true, value: 0 });
    expect(parseGuess(".5", any)).toEqual({ ok: true, value: 0.5 });
    expect(parseGuess("12.", any)).toEqual({ ok: true, value: 12 });
  });
  it("rejects blanks, junk, and disallowed signs/decimals", () => {
    expect(parseGuess("", intOnly)).toMatchObject({ ok: false, reason: "blank" });
    expect(parseGuess(null, intOnly)).toMatchObject({ ok: false, reason: "blank" });
    expect(parseGuess("-", any)).toMatchObject({ ok: false, reason: "blank" });
    expect(parseGuess("12abc", any)).toMatchObject({ ok: false, reason: "invalid" });
    expect(parseGuess("1e5", any)).toMatchObject({ ok: false, reason: "invalid" });
    expect(parseGuess("Infinity", any)).toMatchObject({ ok: false, reason: "invalid" });
    expect(parseGuess("1.2.3", any)).toMatchObject({ ok: false, reason: "invalid" });
    expect(parseGuess("-5", intOnly)).toMatchObject({ ok: false, reason: "negative_not_allowed" });
    expect(parseGuess("5.5", intOnly)).toMatchObject({ ok: false, reason: "decimal_not_allowed" });
    expect(parseGuess("9".repeat(20), any)).toMatchObject({ ok: false, reason: "too_large" });
    expect(parseGuess({ v: 1 }, any)).toMatchObject({ ok: false, reason: "invalid" });
  });
});

describe("validateScoringConfig", () => {
  it("rejects ratio scoring for zero or negative answers", () => {
    expect(validateScoringConfig(ratio, 0, { allowDecimal: true, allowNegative: false })).not.toHaveLength(0);
  });
  it("requires whole years and no decimals for year questions", () => {
    expect(validateScoringConfig(year, 1997.5, { allowDecimal: true, allowNegative: false }).length).toBeGreaterThan(0);
    expect(validateScoringConfig(year, 1997, { allowDecimal: false, allowNegative: false })).toEqual([]);
  });
  it("requires negative input when the answer is negative", () => {
    expect(validateScoringConfig({ type: "absolute", tolerance: 5 }, -40, { allowDecimal: false, allowNegative: false }).length).toBe(1);
  });
  it("checks tolerance bounds", () => {
    expect(validateScoringConfig({ type: "ratio", tolerance: 1 }, 10, { allowDecimal: true, allowNegative: false }).length).toBe(1);
  });
});

describe("previewGuesses", () => {
  it("includes the exact answer and spans both sides", () => {
    const g = previewGuesses(ratio, 1000);
    expect(g).toContain(1000);
    expect(Math.min(...g)).toBeLessThan(1000);
    expect(Math.max(...g)).toBeGreaterThan(1000);
    for (const p of previewGuesses(pct, 3)) expect(p).toBeGreaterThanOrEqual(0);
  });
});
