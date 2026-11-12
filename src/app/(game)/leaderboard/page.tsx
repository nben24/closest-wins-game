"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Onboarding } from "@/components/Onboarding";
import { CenterMessage, Shell, Spinner } from "@/components/Shell";
import { api } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { formatPoints } from "@/lib/format";
import { formatGameDate } from "@/lib/time";
import type { Board, BoardRow } from "@/lib/server/leaderboard";

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
        {weekly && r.daysCounted !== undefined && (
          <span className="block text-sm font-normal text-ink-soft">
            {r.daysCounted} of 5 days counted{r.daysPlayed! > r.daysCounted ? ` (played ${r.daysPlayed})` : ""}
          </span>
        )}
      </span>
      <span className="font-display text-xl tabular-nums">{formatPoints(r.total)}</span>
    </li>
  );
}

function Leaderboard() {
  const [scope, setScope] = useState<"day" | "week">("day");
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ board: Board }>(`/api/leaderboard?scope=${scope}`)
      .then((r) => alive && setBoard(r.board))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [scope]);

  const weekly = scope === "week";
  const meOutsideTop = board?.me && !board.top.some((r) => r.isViewer);

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
            }}
            className={`min-h-11 flex-1 rounded-xl text-base font-bold ${scope === s ? "bg-primary text-primary-fg" : "text-ink-soft"}`}
          >
            {s === "day" ? "Today" : "This week"}
          </button>
        ))}
      </div>
      {error && <CenterMessage title="Couldn't load the leaderboard">{error}</CenterMessage>}
      {!board && !error && <Spinner />}
      {board && (
        <section className="card p-5" aria-label={weekly ? "This week's leaderboard" : "Today's leaderboard"}>
          <p className="text-base text-ink-soft">
            {weekly
              ? `Week of ${formatGameDate(board.weekStart!)} · best 5 days count · ${board.totalPlayers} players`
              : `${formatGameDate(board.date, { weekday: "long", month: "long", day: "numeric" })} · ${board.totalPlayers} finished`}
          </p>
          {board.top.length === 0 ? (
            <p className="mt-3 text-lg">Nobody has finished yet. Be the first!</p>
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
          {!board.me && board.top.length > 0 && (
            <p className="mt-3 text-base text-ink-soft">{weekly ? "Finish a day this week to get on the board." : "Finish today's five to get on the board."}</p>
          )}
        </section>
      )}
      <p className="text-center text-sm text-ink-soft">Only finished games count. Ties share a rank. Want a private league? Use Groups.</p>
    </div>
  );
}
