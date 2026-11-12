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

export function RevealPanel({ data, isDemo, position }: { data: RevealData; isDemo: boolean; position?: number }) {
  const answered = data.guess !== null;
  const unit = data.unit ? ` ${data.unit}` : "";
  const words = formatWords(data.answer);
  return (
    <section className="card animate-rise overflow-hidden" aria-labelledby="reveal-heading">
      <div className="border-b-2 border-line bg-paper/60 px-5 py-4">
        {position && <p className="label">Question {position} of 5</p>}
        <h2 id="reveal-heading" className="mt-1 text-lg font-semibold leading-snug">
          {data.prompt}
        </h2>
      </div>
      <div className="space-y-4 px-5 py-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-paper p-3">
            <p className="label">Your guess</p>
            <p className="mt-1 font-display text-2xl font-extrabold tabular-nums">
              {answered ? `${formatValue(data.guess!, data.scoringType)}${unit}` : "—"}
            </p>
            {!answered && <p className="text-sm text-ink-soft">{data.status === "timed_out" ? "Time ran out" : "No answer"}</p>}
          </div>
          <div className="rounded-2xl bg-ink p-3 text-paper">
            <p className="text-sm font-bold uppercase tracking-wide text-sun">Answer</p>
            <p className="mt-1 animate-pop font-display text-2xl font-extrabold tabular-nums">
              {formatValue(data.answer, data.scoringType)}
              {unit}
            </p>
            {words && data.scoringType !== "year" && <p className="text-sm text-paper/80">≈ {words}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ScoreBadge points={data.score} answered={answered} voided={data.voided} />
          <p className="font-display text-3xl font-extrabold tabular-nums">
            {data.voided ? "—" : `+${formatPoints(data.score)}`}
            <span className="ml-1 text-base font-bold text-ink-soft">pts</span>
          </p>
        </div>
        {answered && !data.voided && (
          <p className="text-base font-semibold text-ink-soft">{describeMiss(data.scoringType, data.answer, data.guess!, data.unit)}</p>
        )}
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
