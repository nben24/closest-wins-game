"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Onboarding } from "@/components/Onboarding";
import { CenterMessage, Shell, Spinner } from "@/components/Shell";
import { api } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { formatPoints } from "@/lib/format";
import { addDays, formatGameDate } from "@/lib/time";
import type { Board, BoardRow, WeekPodium } from "@/lib/server/leaderboard";

export default function LeaderboardPage() {
  const { status, me } = useSession();
  if (status === "loading") return <Shell><Spinner /></Shell>;
  if (!me) return <Shell hideNav><Onboarding /></Shell>;
  return <Shell><Leaderboard /></Shell>;
}

function Row({ r, weekly }: { r: BoardRow; weekly: boolean }) {
  return (
    <li className={`flex items-center gap-3 py-2.5 ${r.isViewer ? "rounded-xl bg-sun-soft px-2 font-bold" : ""}`}>
      <span className={`w-9 text-right font-display text-2xl tabular-nums ${r.rank <= 3 ? "text-sun" : ""}`}>{r.rank}</span>
      <Avatar id={r.avatarId} size="sm" label="" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2 text-lg">
          <span className="truncate">{r.name}</span>
          {r.isViewer && <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-extrabold text-primary-fg">YOU</span>}
        </span>
        {weekly && r.daysPlayed !== undefined && <span className="block text-sm font-normal text-ink-soft">{weekLine(r)}</span>}
      </span>
      <span className="font-display text-xl tabular-nums">{formatPoints(r.total)}</span>
    </li>
  );
}

/** "4 days · avg 2,480" — plus a note when only the best five count. */
function weekLine(r: BoardRow): string {
  const days = `${r.daysPlayed} day${r.daysPlayed === 1 ? "" : "s"}`;
  const avg = r.average !== undefined ? ` · avg ${formatPoints(r.average)}` : "";
  return `${days}${avg}${r.daysPlayed! > r.daysCounted! ? ` · best ${r.daysCounted} count` : ""}`;
}

const MEDALS = ["🥇", "🥈", "🥉"];

function Champions() {
  const [weeks, setWeeks] = useState<WeekPodium[] | null>(null);
  useEffect(() => {
    let alive = true;
    api<{ weeks: WeekPodium[] }>("/api/leaderboard/champions")
      .then((r) => alive && setWeeks(r.weeks))
      .catch(() => alive && setWeeks([]));
    return () => {
      alive = false;
    };
  }, []);
  if (!weeks || weeks.length === 0) return null;
  return (
    <section className="card p-5" aria-labelledby="champions-heading">
      <h2 id="champions-heading" className="title font-display text-2xl">Past champions</h2>
      <ul className="mt-2 divide-y divide-line">
        {weeks.map((w) => (
          <li key={w.weekStart} className="py-3">
            <p className="text-sm font-bold text-ink-soft">
              Week of {formatGameDate(w.weekStart)} · {w.players} player{w.players === 1 ? "" : "s"}
            </p>
            <ol className="mt-1 space-y-1">
              {w.podium.map((r) => (
                <li key={r.playerId} className={`flex items-center gap-2 text-base ${r.isViewer ? "font-bold" : ""}`}>
                  <span aria-label={`Rank ${r.rank}`} className="w-6 text-center">{MEDALS[r.rank - 1]}</span>
                  <Avatar id={r.avatarId} size="sm" label="" />
                  <span className="min-w-0 flex-1 truncate">
                    {r.name}
                    {r.isViewer && <span className="ml-1 text-sm text-sun">(you)</span>}
                  </span>
                  <span className="text-right">
                    <span className="block font-display text-lg tabular-nums">{formatPoints(r.total)}</span>
                    {r.average !== undefined && <span className="block text-xs text-ink-soft">avg {formatPoints(r.average)}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Leaderboard() {
  // The home screen's "This week" leader links to /leaderboard#week.
  const [scope, setScope] = useState<"day" | "week">(() => (typeof window !== "undefined" && window.location.hash === "#week" ? "week" : "day"));
  // Any date inside the week being viewed; null = the current week.
  const [weekOf, setWeekOf] = useState<string | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const q = scope === "week" && weekOf ? `&date=${weekOf}` : "";
    api<{ board: Board }>(`/api/leaderboard?scope=${scope}${q}`)
      .then((r) => alive && setBoard(r.board))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [scope, weekOf]);

  const weekly = scope === "week";
  const meOutsideTop = board?.me && !board.top.some((r) => r.isViewer);
  const currentWeek = weekly && board && !board.final;
  const goWeek = (date: string | null) => {
    setBoard(null);
    setWeekOf(date);
  };

  return (
    <div className="space-y-4">
      <h1 className="title font-display text-4xl font-extrabold">Leaderboard</h1>
      <div className="flex gap-2 rounded-2xl bg-card p-1 ring-2 ring-line" role="tablist" aria-label="Leaderboard period">
        {(["day", "week"] as const).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={scope === s}
            onClick={() => {
              setBoard(null);
              setScope(s);
              setWeekOf(null);
            }}
            className={`min-h-11 flex-1 rounded-xl text-base font-bold ${scope === s ? "bg-primary text-primary-fg" : "text-ink-soft"}`}
          >
            {s === "day" ? "Today" : "Weekly"}
          </button>
        ))}
      </div>
      {error && <CenterMessage title="Couldn't load the leaderboard">{error}</CenterMessage>}
      {!board && !error && <Spinner />}
      {weekly && (
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="btn-ghost min-h-11"
            disabled={!board}
            onClick={() => board && goWeek(addDays(board.weekStart!, -7))}
            aria-label="Previous week"
          >
            ‹ Prev
          </button>
          <p className="text-center text-lg font-bold">
            {!board ? "…" : currentWeek ? "This week" : `Week of ${formatGameDate(board.weekStart!)}`}
            {board?.final && <span className="ml-2 rounded-full bg-sun-soft px-2 py-0.5 text-sm text-sun">Final</span>}
          </p>
          <button
            type="button"
            className="btn-ghost min-h-11 disabled:invisible"
            disabled={!board || !!currentWeek}
            onClick={() => board && goWeek(addDays(board.weekStart!, 7))}
            aria-label="Next week"
          >
            Next ›
          </button>
        </div>
      )}
      {board && (
        <section className="card p-5" aria-label={weekly ? "Weekly leaderboard" : "Today's leaderboard"}>
          <p className="text-base text-ink-soft">
            {weekly
              ? `${formatGameDate(board.weekStart!)} – ${formatGameDate(board.weekEnd!)} · best 5 days count · ${board.totalPlayers} players`
              : `${formatGameDate(board.date, { weekday: "long", month: "long", day: "numeric" })} · ${board.totalPlayers} finished`}
          </p>
          {board.top.length === 0 ? (
            <p className="mt-3 text-lg">{weekly && board.final ? "Nobody played that week." : "Nobody has finished yet. Be the first!"}</p>
          ) : (
            <ol className="mt-2 divide-y divide-line">
              {board.top.map((r) => (
                <Row key={r.playerId} r={r} weekly={weekly} />
              ))}
            </ol>
          )}
          {meOutsideTop && (
            <>
              <p className="mt-2 text-center text-ink-soft" aria-hidden="true">⋯</p>
              <ol>
                <Row r={board.me!} weekly={weekly} />
              </ol>
            </>
          )}
          {!board.me && board.top.length > 0 && !board.final && (
            <p className="mt-3 text-base text-ink-soft">{weekly ? "Finish a day this week to get on the board." : "Finish today's five to get on the board."}</p>
          )}
        </section>
      )}
      {weekly && <Champions />}
      <p className="text-center text-sm text-ink-soft">
        Only finished games count. Ties share a rank. Weekly rankings add up each player&apos;s best 5 days (Monday–Sunday); avg is the average per day played.
      </p>
    </div>
  );
}
