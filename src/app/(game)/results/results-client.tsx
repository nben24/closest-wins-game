"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { NumberLine } from "@/components/NumberLine";
import { RevealPanel } from "@/components/RevealPanel";
import { ScoreBadge } from "@/components/ScoreBadge";
import { ShareButton } from "@/components/ShareButton";
import { CenterMessage, Shell, Spinner } from "@/components/Shell";
import { GAME_TITLE } from "@/config/game";
import { api } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { formatPoints, formatValue } from "@/lib/format";
import { buildNumberLine, questionInsight } from "@/lib/insights";
import { buildShareText } from "@/lib/share";
import { formatGameDate } from "@/lib/time";
import type { ResultsView } from "@/lib/server/results";

const ORDINAL = ["", "one", "two", "three", "four", "five"];

export function ResultsClient() {
  const { status, me } = useSession();
  const params = useSearchParams();
  const date = params.get("date");
  const [data, setData] = useState<ResultsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groupIdx, setGroupIdx] = useState(0);

  useEffect(() => {
    if (!me) return;
    api<ResultsView>(`/api/results${date ? `?date=${encodeURIComponent(date)}` : ""}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [me, date]);

  const shareText = useMemo(() => {
    if (!data?.attempt || data.attempt.status !== "completed") return null;
    return buildShareText({
      title: GAME_TITLE,
      number: data.challenge.number,
      date: data.challenge.date,
      total: data.attempt.totalScore,
      maxTotal: data.attempt.maxScore,
      rounds: data.rounds.map((r) => ({ points: r.reveal!.score, answered: r.reveal!.guess !== null, voided: r.reveal!.voided })),
      url: typeof window !== "undefined" ? window.location.origin : "",
    });
  }, [data]);

  if (status === "loading" || (me && !data && !error)) return <Shell><Spinner /></Shell>;
  if (!me) return <Shell><CenterMessage title="Nothing here yet"><Link className="btn-primary mt-3" href="/">Start playing</Link></CenterMessage></Shell>;
  if (error || !data) return <Shell><CenterMessage title="No results">{error}</CenterMessage></Shell>;
  if (!data.attempt) {
    return (
      <Shell>
        <CenterMessage title={`You haven't played #${data.challenge.number} yet`}>
          <Link className="btn-primary mt-3" href="/play">Play now</Link>
        </CenterMessage>
      </Shell>
    );
  }

  const completed = data.attempt.status === "completed";
  const best = [...data.rounds].filter((r) => r.reveal && !r.reveal.voided && r.reveal.guess !== null).sort((a, b) => b.reveal!.score - a.reveal!.score)[0];
  const group = data.groups?.[groupIdx] ?? null;
  const me_ = group?.standings.find((s) => s.isViewer);

  return (
    <Shell>
      <div className="space-y-5">
        <section className="card p-6 text-center" aria-labelledby="results-heading">
          <p className="label">{GAME_TITLE} #{data.challenge.number} · {formatGameDate(data.challenge.date)}</p>
          <h1 id="results-heading" className="mt-2 font-display text-7xl font-extrabold tabular-nums text-sun animate-pop">
            {formatPoints(data.attempt.totalScore)}
          </h1>
          <p className="text-lg font-semibold text-ink-soft">out of {formatPoints(data.attempt.maxScore)}</p>
          {data.challenge.isDemo && <p className="mt-2 inline-block rounded-full bg-plum-soft px-3 py-1 text-sm font-bold text-plum">Demo questions · not verified</p>}
          {!completed && (
            <p className="mt-3 text-lg">
              You&apos;ve finished {data.attempt.roundsFinished} of 5. <Link href="/play" className="font-bold text-coral underline">Keep going</Link>
            </p>
          )}
          {completed && shareText && <div className="mt-5"><ShareButton text={shareText} /></div>}
        </section>

        <section className="card p-5" aria-labelledby="breakdown-heading">
          <h2 id="breakdown-heading" className="font-display text-xl font-extrabold">Your five</h2>
          <ol className="mt-3 space-y-2">
            {data.rounds.map((r) => (
              <li key={r.position} className="flex items-center justify-between gap-3 rounded-xl bg-paper px-3 py-2">
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-ink-soft">Q{r.position}</span>
                  <span className="block truncate text-base">{r.prompt}</span>
                  <span className="block text-sm text-ink-soft">
                    Answer <strong className="text-ink">{formatValue(r.reveal!.answer, r.scoringType)}{r.unit ? ` ${r.unit}` : ""}</strong>
                    {" · "}You {r.reveal!.guess !== null ? <strong className="text-ink">{formatValue(r.reveal!.guess, r.scoringType)}</strong> : "—"}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-display text-xl font-extrabold tabular-nums">{r.reveal!.voided ? "—" : formatPoints(r.reveal!.score)}</span>
                  <ScoreBadge size="sm" points={r.reveal!.score} answered={r.reveal!.guess !== null} voided={r.reveal!.voided} />
                </span>
              </li>
            ))}
          </ol>
          {best && (
            <p className="mt-3 rounded-xl bg-sun-soft p-3 text-base">
              <span aria-hidden="true">⭐ </span>Best guess: <strong>Q{best.position}</strong> — you said {formatValue(best.reveal!.guess!, best.scoringType)} {best.unit} (answer: {formatValue(best.reveal!.answer, best.scoringType)}).
            </p>
          )}
        </section>

        {completed && data.groups && data.groups.length === 0 && (
          <section className="card p-5 text-center">
            <h2 className="font-display text-xl font-extrabold">Compare with friends</h2>
            <p className="mt-1 text-base text-ink-soft">Create a private group and send the invite to your group chat.</p>
            <Link href="/groups" className="btn-soft mt-3">Start a group</Link>
          </section>
        )}

        {group && (
          <section className="card p-5" aria-labelledby="group-heading">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="group-heading" className="font-display text-xl font-extrabold">{group.label}</h2>
              {data.groups!.length > 1 && (
                <label>
                  <span className="sr-only">Choose group</span>
                  <select className="min-h-11 rounded-xl border-2 border-line bg-card px-2 font-semibold" value={groupIdx} onChange={(e) => setGroupIdx(Number(e.target.value))}>
                    {data.groups!.map((g, i) => <option key={g.groupId} value={i}>{g.label}</option>)}
                  </select>
                </label>
              )}
            </div>
            <p className="mt-1 text-base text-ink-soft">
              {group.finishedCount} of {group.memberCount} finished today{me_ ? ` · you're #${me_.rank}` : ""}
            </p>
            <ol className="mt-3 divide-y divide-line">
              {group.standings.map((s) => (
                <li key={s.playerId} className={`flex items-center gap-3 py-2 ${s.isViewer ? "font-bold" : ""}`}>
                  <span className="w-7 text-right font-display text-lg font-extrabold tabular-nums">{s.rank}</span>
                  <Avatar id={s.avatarId} size="sm" label="" />
                  <span className="flex-1 truncate">{s.isViewer ? `${s.name} (you)` : s.name}</span>
                  <span className="tabular-nums">{formatPoints(s.total)}</span>
                </li>
              ))}
            </ol>
            <Link href={`/groups/${group.groupId}`} className="btn-ghost mt-1">Weekly standings ›</Link>
          </section>
        )}

        <h2 className="pt-2 font-display text-2xl font-extrabold">Answers</h2>
        {data.rounds.map((r) => {
          const guesses = group?.guesses[r.position] ?? [];
          const config = { type: r.scoringType, tolerance: r.reveal!.tolerance };
          const line = guesses.length >= 2 ? buildNumberLine(config, r.reveal!.answer, guesses) : null;
          const insight = guesses.length >= 2 ? questionInsight(config, r.reveal!.answer, guesses) : null;
          return (
            <div key={r.position} className="space-y-2">
              <RevealPanel position={r.position} isDemo={data.challenge.isDemo} data={{ ...r.reveal!, prompt: r.prompt, unit: r.unit, scoringType: r.scoringType, status: r.status }} />
              {line && insight && !r.reveal!.voided && (
                <div className="card p-4">
                  <p className="text-base font-semibold">
                    {insight.viewerIsClosest
                      ? insight.closestNames.length > 1
                        ? `You tied for closest on question ${ORDINAL[r.position]}!`
                        : `You were closest on question ${ORDINAL[r.position]}! 🎯`
                      : `Closest: ${insight.closestNames.join(", ")}`}
                  </p>
                  {insight.direction && (
                    <p className="text-base text-ink-soft">
                      Everyone who finished guessed too {insight.direction === "all_high" ? "high" : "low"}.
                    </p>
                  )}
                  <NumberLine line={line} answer={r.reveal!.answer} type={r.scoringType} unit={r.unit} />
                  <p className="mt-1 text-xs text-ink-soft">{insight.submittedCount} submitted guesses from {group!.label}. Blank and timed-out answers aren&apos;t shown.</p>
                </div>
              )}
            </div>
          );
        })}
        <p className="text-center"><Link href="/history" className="btn-ghost">Past results</Link></p>
      </div>
    </Shell>
  );
}
