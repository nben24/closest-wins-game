import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { Panel } from "@/components/admin/ui";
import { formatPoints } from "@/lib/format";
import { addDays, formatGameDate, isGameDate } from "@/lib/time";
import { dailyBoard, weeklyBoard, type Board } from "@/lib/server/leaderboard";
import { today } from "@/lib/server/challenges";

/** Admin view of the public leaderboards. Read-only; the admin is never added as a player. */
const NOBODY = "00000000-0000-0000-0000-000000000000";

function Table({ board, weekly }: { board: Board; weekly: boolean }) {
  if (board.top.length === 0) return <p className="text-ink-soft">Nobody has finished yet.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-ink-soft">
        <tr>
          <th className="w-12 py-1">Rank</th>
          <th>Player</th>
          {weekly && <th className="text-right">Days counted</th>}
          <th className="text-right">Score</th>
        </tr>
      </thead>
      <tbody>
        {board.top.map((r) => (
          <tr key={r.playerId} className="border-t border-line">
            <td className="py-1.5 font-bold tabular-nums">{r.rank}</td>
            <td>
              <span className="flex items-center gap-2">
                <Avatar id={r.avatarId} size="sm" label="" /> {r.name}
              </span>
            </td>
            {weekly && (
              <td className="text-right tabular-nums">
                {r.daysCounted}
                {r.daysPlayed! > r.daysCounted! ? ` (played ${r.daysPlayed})` : ""}
              </td>
            )}
            <td className="text-right font-bold tabular-nums">{formatPoints(r.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function AdminLeaderboard(props: PageProps<"/admin/leaderboard">) {
  const sp = await props.searchParams;
  const t = today();
  const raw = typeof sp.date === "string" ? sp.date : t;
  const date = isGameDate(raw) && raw <= t ? raw : t;
  const [day, week] = await Promise.all([dailyBoard(NOBODY, date, 200), weeklyBoard(NOBODY, date, 200)]);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-extrabold">Leaderboard</h1>
        <div className="flex items-center gap-2 text-sm">
          <Link className="rounded-lg border border-line px-3 py-1.5 font-semibold" href={`?date=${addDays(date, -1)}`}>‹ Previous day</Link>
          <span className="font-semibold">{formatGameDate(date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</span>
          {date < t && <Link className="rounded-lg border border-line px-3 py-1.5 font-semibold" href={`?date=${addDays(date, 1)}`}>Next day ›</Link>}
          {date !== t && <Link className="underline" href="?">Today</Link>}
        </div>
      </div>
      <p className="text-sm text-ink-soft">Same rankings players see: finished games only, ties share a rank, weekly = best 5 days (Monday–Sunday, New York time).</p>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title={`Day · ${day.totalPlayers} finished`}>
          <Table board={day} weekly={false} />
        </Panel>
        <Panel title={`Week of ${formatGameDate(week.weekStart!)} · ${week.totalPlayers} players`}>
          <Table board={week} weekly />
        </Panel>
      </div>
    </div>
  );
}
