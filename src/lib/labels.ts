import type { ScoringType } from "@/lib/scoring";

/** Shared (server + client) display helpers. Keep this file free of "use client". */
const CATEGORY_LABEL: Record<string, string> = {
  everyday: "Everyday life",
  food: "Food & drink",
  animals: "Animals & nature",
  entertainment: "Movies, music & TV",
  geography: "Places & distances",
  products: "Products & prices",
  sports: "Sports",
  science: "Science & tech",
};

export function categoryLabel(c: string): string {
  return CATEGORY_LABEL[c] ?? c;
}

export function formatHint(type: ScoringType, allowDecimal: boolean, allowNegative: boolean): string {
  if (type === "year") return "Enter a year, like 1995";
  if (type === "percent") return "Enter a percentage from 0 to 100";
  const parts = [allowDecimal ? "Decimals OK" : "Whole number"];
  if (allowNegative) parts.push("can be negative");
  return parts.join(" · ");
}
