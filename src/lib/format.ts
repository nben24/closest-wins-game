import type { ScoringType } from "@/lib/scoring";

const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatNumber(n: number, maxFractionDigits = 6): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: maxFractionDigits }).format(n);
}

export function formatPoints(n: number): string {
  return intFmt.format(n);
}

/** Year values are shown without thousands separators (1997, not 1,997). */
export function formatValue(n: number, type: ScoringType): string {
  if (type === "year") return String(Math.round(n));
  return formatNumber(n);
}

/** "1.5 million" style helper for large numbers; null when not useful. */
export function formatWords(n: number): string | null {
  const abs = Math.abs(n);
  const units: [number, string][] = [
    [1e12, "trillion"],
    [1e9, "billion"],
    [1e6, "million"],
    [1e3, "thousand"],
  ];
  for (const [v, w] of units) {
    if (abs >= v && abs >= 10_000) {
      const x = n / v;
      return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: x >= 100 ? 0 : 2 }).format(x)} ${w}`;
    }
  }
  return null;
}

/** Plain-language distance between guess and answer. */
export function describeMiss(type: ScoringType, answer: number, guess: number, unit: string): string {
  const diff = guess - answer;
  if (Math.abs(diff) <= 1e-9 * Math.max(1, Math.abs(answer))) return "Exactly right!";
  const dir = diff > 0 ? "high" : "low";
  if (type === "year") {
    const y = Math.abs(Math.round(diff));
    return `${y} year${y === 1 ? "" : "s"} ${diff > 0 ? "too late" : "too early"}`;
  }
  if (type === "percent") {
    return `${formatNumber(Math.abs(diff), 2)} percentage point${Math.abs(diff) === 1 ? "" : "s"} too ${dir}`;
  }
  if (type === "ratio" && answer > 0 && guess > 0) {
    const ratio = guess / answer;
    if (ratio >= 2) return `${formatNumber(ratio, 1)}× too high`;
    if (ratio <= 0.5) return `${formatNumber(1 / ratio, 1)}× too low`;
    const pct = Math.abs(ratio - 1) * 100;
    return `${formatNumber(pct, pct < 10 ? 1 : 0)}% too ${dir}`;
  }
  return `${formatNumber(Math.abs(diff))} ${unit} too ${dir}`.replace(/\s+/g, " ");
}
