"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { api } from "@/lib/client/api";
import { formatPoints, formatValue } from "@/lib/format";
import { HALF_POINTS, missNote } from "@/lib/guess-summary";
import { buildNumberLine } from "@/lib/insights";
import type { ScoringType } from "@/lib/scoring";
import type { DayGuesses, Highlight, QuestionGuesses } from "@/lib/server/guesses";

/** Points at which a guess counts as "half points or better". */
const HALF = HALF_POINTS;

const show = (q: { scoringType: ScoringType; unit: string }, v: number) => `${formatValue(v, q.scoringType)}${q.unit ? ` ${q.unit}` : ""}`;

/**
 * "Everyone's guesses" on the leaderboard: unlocked once the viewer finishes
 * the day (the server enforces this; the API returns nothing until then).
 */
export function EveryoneGuesses({ date }: { date: string }) {
  const [data, setData] = useState<DayGuesses | null>(null);
  const [failed, setFailed] = useState(false);
  const [pos, setPos] = useState(1);

  useEffect(() => {
    let alive = true;
    api<{ guesses: DayGuesses }>(`/api/leaderboard/guesses?date=${encodeURIComponent(date)}`)
      .then((r) => alive && setData(r.guesses))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [date]);

  // Links from the results screen land on #guesses.
  useEffect(() => {
    if (data && typeof window !== "undefined" && window.location.hash === "#guesses") {
      document.getElementById("guesses")?.scrollIntoView({ block: "start" });
    }
  }, [data]);

  if (failed || !data || data.number === null) return null;

  if (data.locked) {
    return (
      <section id="guesses" className="card p-5" aria-labelledby="guesses-heading">
        <h2 id="guesses-heading" className="font-display text-2xl font-extrabold">Everyone&apos;s guesses</h2>
        <p className="mt-2 text-lg">
          Finish today&apos;s five to see what everyone guessed. They stay hidden until then so nobody can peek at the answers.
        </p>
        {data.players > 0 && (
          <p className="mt-1 text-base text-ink-soft">
            {data.players} player{data.players === 1 ? " has" : "s have"} finished so far.
          </p>
        )}
        <Link href="/play" className="btn-primary mt-4">Play today&apos;s game</Link>
      </section>
    );
  }

  if (data.players < 2) {
    return (
      <section id="guesses" className="card p-5" aria-labelledby="guesses-heading">
        <h2 id="guesses-heading" className="font-display text-2xl font-extrabold">Everyone&apos;s guesses</h2>
        <p className="mt-2 text-lg">You&apos;re the first to finish! Everyone&apos;s guesses show up here as more people play. Check back later.</p>
      </section>
    );
  }

  const q = data.questions.find((x) => x.position === pos) ?? data.questions[0];

  return (
    <section id="guesses" className="card p-5" aria-labelledby="guesses-heading">
      <h2 id="guesses-heading" className="font-display text-2xl font-extrabold">Everyone&apos;s guesses</h2>
      <p className="mt-1 text-base text-ink-soft">{data.players} players finished. Players still mid-game aren&apos;t shown.</p>

      <div className="mt-3 grid grid-cols-5 gap-2" role="group" aria-label="Choose a question">
            {data.questions.map((x) => (
              <button
                key={x.position}
                type="button"
                aria-pressed={x.position === q.position}
                aria-label={`Question ${x.position}`}
                onClick={() => setPos(x.position)}
                className={`min-h-11 rounded-xl border-2 text-base font-extrabold ${x.position === q.position ? "border-primary bg-primary text-primary-fg" : "border-line bg-paper"}`}
              >
                Q{x.position}
              </button>
            ))}
      </div>
      <QuestionView q={q} />
    </section>
  );
}

function QuestionView({ q }: { q: QuestionGuesses }) {
  const answered = q.dots.length;
  const lowPct = answered ? Math.round((q.tooLow / answered) * 100) : 0;
  const highPct = answered ? Math.round((q.tooHigh / answered) * 100) : 0;
  const mine = q.mine;

  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-2xl bg-paper p-4">
        <p className="text-base font-semibold">{q.prompt}</p>
        <p className="mt-2 flex items-center gap-2">
          <span className="label">Answer</span>
          <span className="rounded-lg bg-secondary px-2 py-0.5 font-display text-xl font-extrabold text-secondary-fg">{show(q, q.answer)}</span>
        </p>
        {q.voided && <p className="mt-2 text-base text-ink-soft">This question was removed from scoring.</p>}
      </div>

      {answered >= 2 && <GuessStrip q={q} />}

      {answered > 0 && (
        <p className="text-base text-ink-soft">
          {q.median !== null && <>Middle guess <strong className="text-ink">{show(q, q.median)}</strong> · </>}
          {lowPct}% too low · {highPct}% too high
          {!q.voided && <> · {q.halfOrBetter} of {q.finished} got half points or more</>}
          {q.noAnswer > 0 && <> · {q.noAnswer} didn&apos;t answer</>}
        </p>
      )}

      {!q.voided && (q.closest.length > 0 || q.wildest) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {q.closest.length > 0 && (
            <HighlightCard
              tone="hit"
              icon="🎯"
              title={q.closestCount > 1 ? `Closest (${q.closestCount}-way tie)` : "Closest"}
              people={q.closest}
              more={q.closestCount - q.closest.length}
              value={show(q, q.closest[0].guess)}
              note={missNote(q.scoringType, q.answer, q.closest[0].guess)}
            />
          )}
          {q.wildest && (
            <HighlightCard
              tone="coral"
              icon="🤯"
              title="Wildest guess"
              people={[q.wildest]}
              more={q.wildestOthers}
              moreText={`+ ${q.wildestOthers} other${q.wildestOthers === 1 ? "" : "s"} just as far off`}
              value={show(q, q.wildest.guess)}
              note={missNote(q.scoringType, q.answer, q.wildest.guess)}
            />
          )}
        </div>
      )}

      {mine && !q.voided && (
        <p className="rounded-xl bg-sun-soft p-3 text-base">
          {mine.guess === null ? (
            <>You didn&apos;t answer this one.</>
          ) : (
            <>
              You guessed <strong>{show(q, mine.guess)}</strong> ({missNote(q.scoringType, q.answer, mine.guess)}) for{" "}
              <strong>{formatPoints(mine.score)}</strong> points.
            </>
          )}
        </p>
      )}
    </div>
  );
}

function HighlightCard({ tone, icon, title, people, more, moreText, value, note }: {
  tone: "hit" | "coral"; icon: string; title: string; people: Highlight[]; more: number; moreText?: string; value: string; note: string;
}) {
  return (
    <div className={`rounded-2xl p-3 ${tone === "hit" ? "bg-hit-soft" : "bg-coral-soft"}`}>
      <p className={`text-sm font-extrabold uppercase ${tone === "hit" ? "text-hit" : "text-coral"}`}>
        <span aria-hidden="true">{icon} </span>{title}
      </p>
      <p className="mt-1 font-display text-2xl font-extrabold tabular-nums">{value}</p>
      <p className="text-sm font-semibold text-ink-soft">{note === "exact" ? "Exactly right!" : note}</p>
      <ul className="mt-2 space-y-1">
        {people.map((p, i) => (
          <li key={i} className="flex items-center gap-2 font-bold">
            <Avatar id={p.avatarId} size="sm" label="" />
            <span className="truncate">{p.isViewer ? `${p.name} (you)` : p.name}</span>
          </li>
        ))}
        {more > 0 && <li className="text-sm text-ink-soft">{moreText ?? `+ ${more} more`}</li>}
      </ul>
    </div>
  );
}

/** Every finished player's guess as a dot on one line, with the answer marked. */
function GuessStrip({ q }: { q: QuestionGuesses }) {
  const points = q.dots.map((d, i) => ({ playerId: `d${i}`, name: "", avatarId: "", guess: d.guess, isViewer: d.isViewer, score: d.score }));
  const line = buildNumberLine({ type: q.scoringType, tolerance: q.tolerance }, q.answer, points);
  if (!line) return null;
  const score = new Map(points.map((p) => [p.playerId, p.score]));
  const rows: number[] = [];
  const placed = [...line.points]
    .sort((a, b) => a.x - b.x)
    .map((p) => {
      let row = 0;
      while (rows[row] !== undefined && p.x - rows[row] < 0.035) row++;
      rows[row] = p.x;
      return { ...p, row };
    });
  const height = 34 + Math.max(1, rows.length) * 15 + 28;
  const pinned = line.points.some((p) => p.clamped);

  return (
    <figure className="rounded-2xl bg-paper px-4 pt-3 pb-2" aria-label={`Chart of ${points.length} guesses. The answer is ${show(q, q.answer)}.`}>
      <div className="relative" style={{ height }}>
        <div className="absolute inset-x-0 bottom-6 h-0.5 rounded-full bg-ink/20" aria-hidden="true" />
        <div className="absolute bottom-6 top-7 w-0.5 -translate-x-1/2 bg-ink" style={{ left: `${line.answerX * 100}%` }} aria-hidden="true" />
        <div
          className="absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-md bg-secondary px-1.5 py-0.5 text-xs font-extrabold text-secondary-fg"
          style={{ left: `${Math.min(92, Math.max(8, line.answerX * 100))}%` }}
          aria-hidden="true"
        >
          {formatValue(q.answer, q.scoringType)}
        </div>
        {placed.map((p) => (
          <span
            key={p.playerId}
            aria-hidden="true"
            title={`${p.isViewer ? "You: " : ""}${formatValue(p.guess, q.scoringType)}`}
            className={`absolute -translate-x-1/2 rounded-full ${
              p.isViewer ? "h-4 w-4 bg-coral ring-4 ring-coral-soft" : (score.get(p.playerId) ?? 0) >= HALF ? "h-3 w-3 bg-hit" : "h-3 w-3 bg-ink/35"
            }`}
            style={{ left: `${p.x * 100}%`, bottom: 32 + p.row * 15 }}
          />
        ))}
        <span className="absolute bottom-0 left-0 text-xs font-semibold text-ink-soft" aria-hidden="true">{pinned && line.points.some((p) => p.clamped === "low") ? "≤ " : ""}{formatValue(line.min, q.scoringType)}</span>
        <span className="absolute bottom-0 right-0 text-xs font-semibold text-ink-soft" aria-hidden="true">{pinned && line.points.some((p) => p.clamped === "high") ? "≥ " : ""}{formatValue(line.max, q.scoringType)}</span>
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-ink-soft">
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-coral" aria-hidden="true" />You</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-hit" aria-hidden="true" />Half points or more</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-ink/35" aria-hidden="true" />Everyone else</span>
        {line.scale === "log" && <span>Spaced by how many times off</span>}
        {pinned && <span>Way-off guesses sit at the ends</span>}
      </figcaption>
    </figure>
  );
}
