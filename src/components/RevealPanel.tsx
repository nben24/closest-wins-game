"use client";

import { ScoreBadge } from "@/components/ScoreBadge";
import { describeMiss, formatPoints, formatValue, formatWords } from "@/lib/format";
import type { ScoringType } from "@/lib/scoring";

export interface RevealData {
  prompt: string;
  unit: string;
  scoringType: ScoringType;
  guess: number | null;
  answer: number;
  score: number;
  explanation: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  referencePeriod: string | null;
  voided?: boolean;
  voidedReason?: string | null;
  status?: string;
}

/**
 * Answer-first reveal: the correct answer is the hero, then how your guess
 * compares, then the points, then the "oh wow" explanation and source.
 */
export function RevealPanel({ data, isDemo, position }: { data: RevealData; isDemo: boolean; position?: number }) {
  const answered = data.guess !== null;
  const unit = data.unit ? ` ${data.unit}` : "";
  const words = data.scoringType !== "year" ? formatWords(data.answer) : null;
  return (
    <section className="card animate-rise overflow-hidden" aria-labelledby={position ? `reveal-${position}` : undefined}>
      <div className="px-5 pt-4">
        {position && <p className="label">Question {position} of 5</p>}
        <h2 id={position ? `reveal-${position}` : undefined} className="mt-1 text-base font-semibold leading-snug text-ink-soft">
          {data.prompt}
        </h2>
      </div>

      <div className="mx-4 mt-3 rounded-2xl bg-answer px-4 py-4 text-center text-answer-fg">
        <p className="text-sm font-bold tracking-wider uppercase opacity-90">The answer</p>
        <p className="mt-1 animate-pop font-display text-5xl leading-none font-extrabold tabular-nums">
          {formatValue(data.answer, data.scoringType)}
          {data.unit && <span className="ml-2 align-middle text-2xl">{data.unit}</span>}
        </p>
        {words && <p className="mt-1 text-sm font-semibold opacity-90">≈ {words}</p>}
      </div>

      <div className="space-y-3 px-5 pt-4 pb-5">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="label">Your guess</p>
            <p className="font-display text-3xl font-extrabold tabular-nums">
              {answered ? `${formatValue(data.guess!, data.scoringType)}${unit}` : "—"}
            </p>
          </div>
          <p className="text-right text-base font-semibold text-ink-soft">
            {answered
              ? describeMiss(data.scoringType, data.answer, data.guess!, data.unit)
              : data.status === "timed_out"
                ? "Time ran out"
                : "No answer"}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t-2 border-line pt-3">
          <ScoreBadge points={data.score} answered={answered} voided={data.voided} />
          <p className="font-display text-3xl font-extrabold tabular-nums text-sun">
            {data.voided ? "—" : `+${formatPoints(data.score)}`}
            <span className="ml-1 text-base text-ink-soft">pts</span>
          </p>
        </div>

        {data.voided && (
          <p className="rounded-xl bg-sun-soft p-3 text-base">
            This question was voided for everyone{data.voidedReason ? `: ${data.voidedReason}` : "."} It doesn&apos;t count toward anyone&apos;s score.
          </p>
        )}
        {data.explanation && <p className="text-lg leading-relaxed">{data.explanation}</p>}
        <div className="text-sm text-ink-soft">
          {data.referencePeriod && <p>Reference period: {data.referencePeriod}</p>}
          {data.sourceUrl && (
            <p>
              {isDemo ? "Reference (demo, not verified): " : "Source: "}
              <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-sky underline underline-offset-2">
                {data.sourceTitle || new URL(data.sourceUrl).hostname}
              </a>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
