"use client";

import type { ReactNode } from "react";
import { Keypad } from "@/components/Keypad";
import { displayInput } from "@/lib/client/number-input";
import { formatWords } from "@/lib/format";
import type { ScoringType } from "@/lib/scoring";

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

export function categoryLabel(c: string) {
  return CATEGORY_LABEL[c] ?? c;
}

export function formatHint(type: ScoringType, allowDecimal: boolean, allowNegative: boolean): string {
  if (type === "year") return "Enter a year, like 1995";
  if (type === "percent") return "Enter a percentage from 0 to 100";
  const parts = [allowDecimal ? "Decimals OK" : "Whole number"];
  if (allowNegative) parts.push("can be negative");
  return parts.join(" · ");
}

interface Props {
  position?: number;
  prompt: string;
  unit: string;
  category?: string;
  scoringType: ScoringType;
  allowDecimal: boolean;
  allowNegative: boolean;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  inputEnabled: boolean;
  timer?: ReactNode;
  submitLabel?: string;
  statusNote?: string | null;
  progress?: ReactNode;
}

export function QuestionCard(p: Props) {
  const num = p.value && p.value !== "-" && p.value !== "." ? Number(p.value) : null;
  const words = num !== null && Number.isFinite(num) && p.scoringType !== "year" ? formatWords(num) : null;
  return (
    <div className="flex flex-col gap-2">
      <section className="card px-4 py-3 sm:p-5" aria-labelledby="question-prompt">
        <div className="mb-1.5 flex items-center justify-between gap-2 text-sm font-bold text-ink-soft">
          <span>
            {p.position ? `Question ${p.position} of 5` : "Practice"}
            {p.category ? ` · ${categoryLabel(p.category)}` : ""}
          </span>
          {p.progress}
        </div>
        <h1 id="question-prompt" className="font-display text-[1.45rem] [@media(max-height:620px)]:text-xl leading-tight font-extrabold sm:text-3xl">
          {p.prompt}
        </h1>
        {p.timer && <div className="mt-2.5">{p.timer}</div>}
      </section>

      <div
        className={`rounded-2xl border-2 px-4 py-2 ${p.inputEnabled ? "border-ink bg-card" : "border-line bg-paper"}`}
        aria-live="off"
      >
        <div className="flex items-baseline justify-between gap-2">
          <output
            className={`min-h-10 font-display text-[2rem] leading-tight font-extrabold tabular-nums break-all ${p.value ? "text-ink" : "text-ink-soft/60"}`}
            aria-label={`Your answer${p.unit ? ` in ${p.unit}` : ""}`}
          >
            {p.value ? displayInput(p.value) : p.inputEnabled ? "Your guess" : "Get ready…"}
          </output>
          {p.unit && <span className="shrink-0 text-xl font-bold text-ink-soft">{p.unit}</span>}
        </div>
        <p className="mt-0.5 text-sm text-ink-soft [@media(max-height:620px)]:hidden">{words ? `≈ ${words} · ` : ""}{formatHint(p.scoringType, p.allowDecimal, p.allowNegative)}</p>
      </div>
      {p.statusNote && <p className="text-center text-base font-semibold text-ink-soft" role="status">{p.statusNote}</p>}

      <div>
        <Keypad
          value={p.value}
          onChange={p.onChange}
          onSubmit={p.onSubmit}
          disabled={!p.inputEnabled}
          allowDecimal={p.allowDecimal}
          allowNegative={p.allowNegative}
          showMagnitudes={p.scoringType === "ratio"}
          submitLabel={p.submitLabel}
        />
      </div>
    </div>
  );
}
