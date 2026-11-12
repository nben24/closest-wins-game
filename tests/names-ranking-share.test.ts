import { describe, expect, it } from "vitest";
import {
  GROUP_ADJECTIVES, GROUP_NOUNS, NAME_ADJECTIVES, NAME_NOUNS, allowedSuffixes, isCombinationAllowed,
  suggestIdentity, validateGroupLabel, validateNickname,
} from "@/lib/names";
import { rankByScore, weeklyTotal } from "@/lib/ranking";
import { buildShareText } from "@/lib/share";
import { buildNumberLine, questionInsight } from "@/lib/insights";

describe("names", () => {
  it("rejects anything not from the approved lists", () => {
    expect(validateNickname("Sunny", "Otter")).toBeNull();
    expect(validateNickname("sunny", "Otter")).not.toBeNull();
    expect(validateNickname("Evil", "Otter")).not.toBeNull();
    expect(validateNickname("Sunny", "<script>")).not.toBeNull();
    expect(validateNickname(1, 2)).not.toBeNull();
    expect(validateGroupLabel("Lucky", "Guessers")).toBeNull();
    expect(validateGroupLabel("Lucky", "Anything I want")).not.toBeNull();
  });
  it("screens every combination and leaves plenty available", () => {
    let allowed = 0;
    for (const a of NAME_ADJECTIVES) for (const n of NAME_NOUNS) if (isCombinationAllowed(a, n)) allowed++;
    expect(allowed).toBeGreaterThan(NAME_ADJECTIVES.length * NAME_NOUNS.length * 0.95);
    for (const a of GROUP_ADJECTIVES) for (const n of GROUP_NOUNS) expect(typeof isCombinationAllowed(a, n)).toBe("boolean");
  });
  it("blocks unfortunate run-together combinations", () => {
    expect(isCombinationAllowed("Cl", "assy")).toBe(false);
  });
  it("never assigns blocked suffixes", () => {
    const s = allowedSuffixes();
    expect(s).not.toContain(69);
    expect(s).not.toContain(88);
    expect(s.length).toBeGreaterThan(80);
  });
  it("suggests valid identities", () => {
    for (let i = 0; i < 50; i++) {
      const s = suggestIdentity();
      expect(validateNickname(s.adjective, s.noun)).toBeNull();
    }
  });
});

describe("ranking", () => {
  it("shares rank on ties and skips the next rank", () => {
    const r = rankByScore(
      [{ n: "a", s: 3000 }, { n: "b", s: 4000 }, { n: "c", s: 3000 }, { n: "d", s: 1000 }],
      (x) => x.s,
      (x) => x.n,
    );
    expect(r.map((x) => [x.n, x.rank])).toEqual([["b", 1], ["a", 2], ["c", 2], ["d", 4]]);
  });
  it("sums the best five days of a week", () => {
    expect(weeklyTotal([100, 200, 300, 400, 500, 600, 700])).toEqual({ total: 2500, daysPlayed: 7, daysCounted: 5 });
    expect(weeklyTotal([100, 200])).toEqual({ total: 300, daysPlayed: 2, daysCounted: 2 });
    expect(weeklyTotal([])).toEqual({ total: 0, daysPlayed: 0, daysCounted: 0 });
  });
});

describe("share text", () => {
  it("is spoiler-free", () => {
    const text = buildShareText({
      number: 12, date: "2026-11-11", total: 3456,
      rounds: [
        { points: 1000, answered: true, voided: false },
        { points: 750, answered: true, voided: false },
        { points: 450, answered: true, voided: false },
        { points: 120, answered: true, voided: false },
        { points: 0, answered: false, voided: false },
      ],
      url: "https://example.com", title: "Closest Wins",
    });
    expect(text).toBe("Closest Wins #12 · Nov 11\n3,456 / 5,000\n🎯🟢🟡🟠⚪\nhttps://example.com");
  });
});

describe("insights", () => {
  const g = (id: string, guess: number, isViewer = false) => ({ playerId: id, name: id, avatarId: "otter", guess, isViewer });
  it("finds the closest player and requires 2+ guesses", () => {
    expect(questionInsight({ type: "ratio", tolerance: 1.5 }, 100, [g("me", 90, true)]).closestNames).toEqual([]);
    const i = questionInsight({ type: "ratio", tolerance: 1.5 }, 100, [g("me", 90, true), g("b", 200)]);
    expect(i.viewerIsClosest).toBe(true);
    expect(i.direction).toBeNull();
  });
  it("reports all-high only with enough players", () => {
    const c = { type: "absolute" as const, tolerance: 5 };
    expect(questionInsight(c, 10, [g("a", 11), g("b", 12)]).direction).toBeNull();
    expect(questionInsight(c, 10, [g("a", 11), g("b", 12), g("c", 30)]).direction).toBe("all_high");
  });
  it("pins extreme outliers to the edges", () => {
    const line = buildNumberLine({ type: "ratio", tolerance: 1.5 }, 100, [g("a", 1e9), g("b", 120), g("c", 0)])!;
    expect(line.scale).toBe("log");
    const a = line.points.find((p) => p.playerId === "a")!;
    expect(a.clamped).toBe("high");
    expect(line.points.find((p) => p.playerId === "c")!.clamped).toBe("low");
    for (const p of line.points) { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(1); }
    expect(line.answerX).toBeGreaterThan(0);
    expect(line.answerX).toBeLessThan(1);
  });
});

import { displayInput, pressKey, shiftDecimal } from "@/lib/client/number-input";
describe("keypad input", () => {
  const any = { allowDecimal: true, allowNegative: true };
  const intOnly = { allowDecimal: false, allowNegative: false };
  it("builds numbers safely", () => {
    let v = "";
    for (const k of ["0", "0", "1", "2"]) v = pressKey(v, k, intOnly);
    expect(v).toBe("12");
    expect(pressKey("12", ".", intOnly)).toBe("12");
    expect(pressKey("", ".", any)).toBe("0.");
    expect(pressKey("5", "neg", any)).toBe("-5");
    expect(pressKey("5", "neg", intOnly)).toBe("5");
    expect(pressKey("1.5", ".", any)).toBe("1.5");
  });
  it("applies magnitude shortcuts exactly", () => {
    expect(shiftDecimal("1.5", 6)).toBe("1500000");
    expect(shiftDecimal("2", 3)).toBe("2000");
    expect(shiftDecimal("0.0001", 3)).toBe("0.1");
    expect(shiftDecimal("-3.25", 9)).toBe("-3250000000");
  });
  it("formats for display", () => {
    expect(displayInput("1234567.5")).toBe("1,234,567.5");
    expect(displayInput("-1000")).toBe("−1,000");
    expect(displayInput("12.")).toBe("12.");
  });
});

import { normalizeSupabaseUrl } from "@/lib/supabase/url";
describe("supabase url", () => {
  it("strips pasted API paths", () => {
    expect(normalizeSupabaseUrl("https://abc.supabase.co/rest/v1/")).toBe("https://abc.supabase.co");
    expect(normalizeSupabaseUrl(" https://abc.supabase.co/ ")).toBe("https://abc.supabase.co");
    expect(normalizeSupabaseUrl("https://abc.supabase.co")).toBe("https://abc.supabase.co");
    expect(normalizeSupabaseUrl("")).toBeUndefined();
  });
});
