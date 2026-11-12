"use client";

import Link from "next/link";
import { useState } from "react";
import { QuestionCard } from "@/components/QuestionCard";
import { RevealPanel } from "@/components/RevealPanel";
import { Shell } from "@/components/Shell";
import { PRACTICE_QUESTIONS } from "@/lib/demo-questions";
import { parseGuess, scoreGuess } from "@/lib/scoring";

/**
 * Untimed practice. Runs entirely in the browser with public practice
 * questions; nothing is sent to the server, scored, or ranked.
 */
export default function PracticePage() {
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState("");
  const [revealed, setRevealed] = useState<{ guess: number | null; score: number } | null>(null);
  const q = PRACTICE_QUESTIONS[index % PRACTICE_QUESTIONS.length];

  const submit = () => {
    const p = parseGuess(value, q);
    const guess = p.ok ? p.value : null;
    setRevealed({ guess, score: scoreGuess({ type: q.scoringType, tolerance: q.tolerance }, q.answer, guess) });
  };

  return (
    <Shell compact>
      <p className="mb-2 rounded-xl bg-sky-soft px-4 py-1.5 text-center text-base font-semibold text-sky">
        Practice · no timer · doesn&apos;t count
      </p>
      {!revealed ? (
        <QuestionCard
          prompt={q.prompt}
          unit={q.unit}
          scoringType={q.scoringType}
          allowDecimal={q.allowDecimal}
          allowNegative={q.allowNegative}
          value={value}
          onChange={setValue}
          onSubmit={submit}
          inputEnabled
          submitLabel="Check my guess"
          statusNote="No timer here. The real game gives 4s to read, 10s to answer."
        />
      ) : (
        <div className="space-y-4">
          <RevealPanel
            isDemo={false}
            data={{ prompt: q.prompt, unit: q.unit, scoringType: q.scoringType, guess: revealed.guess, answer: q.answer, score: revealed.score, explanation: q.explanation, sourceUrl: null, sourceTitle: null, referencePeriod: null }}
          />
          <p className="text-center text-base text-ink-soft">Exact answers earn 1,000. Being close still earns plenty.</p>
          <Link href="/play" className="btn-primary w-full text-xl">Play today&apos;s five</Link>
          <button
            type="button"
            className="btn-soft w-full"
            onClick={() => {
              setIndex(index + 1);
              setValue("");
              setRevealed(null);
            }}
          >
            Another practice question
          </button>
        </div>
      )}
    </Shell>
  );
}
