"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { api } from "@/lib/client/api";
import { formatPoints, formatValue } from "@/lib/format";
import { closestGuesses, missNote, wildestGuess, type PlayerGuess } from "@/lib/guess-summary";
import { buildNumberLine } from "@/lib/insights";
import type { ScoringType } from "@/lib/scoring";
import type { DayGuesses, QuestionGuesses } from "@/lib/server/guesses";

/** Points at which a guess counts as "half points or better". */
const HALF = 500;

const show = (q: { scoringType: ScoringType; unit: string }, v: number) => `${formatValue(v, q.scoringType)}${q.unit ? ` ${q.unit}` : ""}`;

/**
 * "Everyone's guesses" on the leaderboard: unlocked once the viewer finishes
 * the day (the server enforces this; the API returns nothing until then).
 */
export function EveryoneGuesses({ date }: { date: string }) {
  const [data, setData] = useState<DayGuesses | null>(null);
  const [failed, setFailed] = useState(false);
  const [pos, setPos] = useState(1);
  const [view, setView] = useState<"question" | "table">("question");

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="guesses-heading" className="font-display text-2xl font-extrabold">Everyone&apos;s guesses</h2>
        <div className="flex gap-1 rounded-xl bg-paper p-1 ring-2 ring-line" role="group" aria-label="Guesses view">
          {(["question", "table"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`min-h-11 rounded-lg px-3 text-sm font-bold ${view === v ? "bg-primary text-primary-fg" : "text-ink-soft"}`}
            >
              {v === "question" ? "By question" : "All at once"}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-base text-ink-soft">{data.players} players finished. Players still mid-game aren&apos;t shown.</p>

      {view === "question" ? (
        <>
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
        </>
      ) : (
        <AllTable data={data} />
      )}
    </section>
  );
}

function QuestionView({ q }: { q: QuestionGuesses }) {
  const closest = q.voided ? [] : closestGuesses(q.scoringType, q.answer, q.guesses);
  const wild = q.voided ? null : wildestGuess(q.scoringType, q.answer, q.guesses);
  const closestIds = new Set(closest.map((g) => g.playerId));
  const answered = q.guesses.filter((g) => g.guess !== null);
  const half = q.guesses.filter((g) => g.score >= HALF).length;
  const mine = q.guesses.find((g) => g.isViewer);

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

      {answered.length >= 2 && <GuessStrip q={q} />}

      {!q.voided && answered.length > 0 && (
        <div className="flex flex-wrap gap-2 text-sm font-bold">
          {closest.length > 0 && (
            <span className="rounded-lg bg-hit-soft px-2 py-1 text-hit">
              Closest: {show(q, closest[0].guess!)}
              {closest.length > 1 ? ` (${closest.length} players)` : ` · ${closest[0].isViewer ? "you" : closest[0].name}`}
            </span>
          )}
          {wild && (
            <span className="rounded-lg bg-coral-soft px-2 py-1 text-coral">
              Wildest: {show(q, wild.guess!)} · {wild.isViewer ? "you" : wild.name}
            </span>
          )}
          <span className="rounded-lg bg-paper px-2 py-1 text-ink-soft ring-1 ring-line">
            {half} of {q.guesses.length} got half points or more
          </span>
        </div>
      )}
      {mine && mine.guess !== null && !q.voided && (
        <p className="text-base">
          You guessed <strong>{show(q, mine.guess)}</strong> ({missNote(q.scoringType, q.answer, mine.guess)}) for <strong>{formatPoints(mine.score)}</strong> points.
        </p>
      )}

      <ol className="space-y-1.5" aria-label={`Guesses for question ${q.position}`}>
        {q.guesses.map((g) => (
          <GuessRow key={g.playerId} q={q} g={g} closest={closestIds.has(g.playerId)} wild={wild?.playerId === g.playerId} />
        ))}
      </ol>
    </div>
  );
}

function GuessRow({ q, g, closest, wild }: { q: QuestionGuesses; g: PlayerGuess; closest: boolean; wild: boolean }) {
  const exact = g.guess !== null && missNote(q.scoringType, q.answer, g.guess) === "exact";
  return (
    <li className={`flex items-center gap-3 rounded-xl px-3 py-2 ${g.isViewer ? "bg-sun-soft ring-2 ring-sun" : "bg-paper"}`}>
      <Avatar id={g.avatarId} size="sm" label="" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-bold">{g.name}</span>
          {g.isViewer && <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-extrabold text-primary-fg">YOU</span>}
        </span>
        {!q.voided && g.guess !== null && (exact || closest || wild) && (
          <span className="mt-0.5 flex flex-wrap gap-1">
            {exact ? (
              <span className="rounded-full bg-hit-soft px-2 py-0.5 text-xs font-extrabold text-hit">EXACT</span>
            ) : closest ? (
              <span className="rounded-full bg-hit-soft px-2 py-0.5 text-xs font-extrabold text-hit">CLOSEST</span>
            ) : null}
            {wild && (
              <span className="rounded-full bg-coral-soft px-2 py-0.5 text-xs font-extrabold text-coral">
                WILDEST · {missNote(q.scoringType, q.answer, g.guess)}
              </span>
            )}
          </span>
        )}
      </span>
      <span className="text-right">
        <span className="block font-display text-lg font-extrabold tabular-nums">{g.guess === null ? "—" : formatValue(g.guess, q.scoringType)}</span>
        <span className={`block text-xs font-bold ${g.score >= HALF ? "text-hit" : "text-ink-soft"}`}>
          {g.guess === null ? "no answer" : q.voided ? "not counted" : `${formatPoints(g.score)} pts`}
        </span>
      </span>
    </li>
  );
}

/** Every finished player's guess as a dot on one line, with the answer marked. */
function GuessStrip({ q }: { q: QuestionGuesses }) {
  const points = q.guesses
    .filter((g): g is PlayerGuess & { guess: number } => g.guess !== null)
    .map((g) => ({ playerId: g.playerId, name: g.name, avatarId: g.avatarId, guess: g.guess, isViewer: g.isViewer, score: g.score }));
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
            title={`${p.isViewer ? "You" : p.name}: ${formatValue(p.guess, q.scoringType)}`}
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

/** Every player × every question in one scrollable table. */
function AllTable({ data }: { data: DayGuesses }) {
  const best = new Map<number, Set<string>>();
  const wild = new Map<number, string | null>();
  const cell = new Map<string, PlayerGuess>();
  for (const q of data.questions) {
    best.set(q.position, new Set(q.voided ? [] : closestGuesses(q.scoringType, q.answer, q.guesses).map((g) => g.playerId)));
    wild.set(q.position, q.voided ? null : (wildestGuess(q.scoringType, q.answer, q.guesses)?.playerId ?? null));
    for (const g of q.guesses) cell.set(`${q.position}:${g.playerId}`, g);
  }
  return (
    <div className="mt-3">
      <div className="mb-2 flex flex-wrap gap-2 text-xs font-bold">
        <span className="rounded-full bg-hit-soft px-2 py-0.5 text-hit">Closest</span>
        <span className="rounded-full bg-coral-soft px-2 py-0.5 text-coral">Wildest</span>
        <span className="rounded-full bg-sun-soft px-2 py-0.5 text-ink">You</span>
      </div>
      <div className="-mx-2 overflow-x-auto px-2 pb-1" tabIndex={0} aria-label="All guesses table (scrolls sideways)">
        <table className="w-full min-w-[640px] border-separate border-spacing-y-1 text-sm">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-card px-2 text-left text-xs font-bold uppercase text-ink-soft">Player</th>
              {data.questions.map((q) => (
                <th key={q.position} scope="col" className="px-2 text-right align-bottom">
                  <span className="block text-xs font-bold uppercase text-ink-soft">Q{q.position}</span>
                  <span className="mt-0.5 inline-block whitespace-nowrap rounded-md bg-secondary px-1.5 text-xs font-extrabold text-secondary-fg">
                    {formatValue(q.answer, q.scoringType)}
                  </span>
                </th>
              ))}
              <th scope="col" className="px-2 text-right align-bottom text-xs font-bold uppercase text-ink-soft">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.standings.map((s) => {
              const rowBg = s.isViewer ? "bg-sun-soft" : "bg-paper";
              return (
                <tr key={s.playerId}>
                  <th scope="row" className={`sticky left-0 z-10 rounded-l-xl px-2 py-1.5 text-left font-bold whitespace-nowrap ${rowBg}`}>
                    <span className="inline-flex items-center gap-2">
                      <span className="w-5 text-right font-display tabular-nums text-ink-soft">{s.rank}</span>
                      <Avatar id={s.avatarId} size="sm" label="" />
                      <span className="max-w-[9rem] truncate">{s.name}</span>
                    </span>
                  </th>
                  {data.questions.map((q) => {
                    const g = cell.get(`${q.position}:${s.playerId}`);
                    const isBest = best.get(q.position)?.has(s.playerId);
                    const isWild = wild.get(q.position) === s.playerId;
                    return (
                      <td key={q.position} className={`px-2 py-1.5 text-right whitespace-nowrap ${isBest ? "bg-hit-soft" : isWild ? "bg-coral-soft" : rowBg}`}>
                        <span className="block font-bold tabular-nums">{!g || g.guess === null ? "—" : formatValue(g.guess, q.scoringType)}</span>
                        <span className={`block text-xs ${g && g.score >= HALF ? "font-bold text-hit" : "text-ink-soft"}`}>
                          {q.voided ? "not counted" : `${formatPoints(g?.score ?? 0)}`}
                        </span>
                      </td>
                    );
                  })}
                  <td className={`rounded-r-xl px-2 py-1.5 text-right font-display text-lg font-extrabold tabular-nums ${rowBg}`}>{formatPoints(s.total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
