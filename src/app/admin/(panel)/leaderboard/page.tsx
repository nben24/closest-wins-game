import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { Panel } from "@/components/admin/ui";
import { formatPoints } from "@/lib/format";
import { addDays, formatGameDate, isGameDate } from "@/lib/time";
import { allTimeStats, dailyBoard, pastWeeks, weeklyBoard, type AllTimeRow, type Board, type BoardRow } from "@/lib/server/leaderboard";
import { today } from "@/lib/server/challenges";
import { ensurePrizeCodes } from "@/lib/server/prizes";

/** Admin view of the public leaderboards. Read-only; the admin is never added as a player. */
const NOBODY = "00000000-0000-0000-0000-000000000000";

type WeekSort = "total" | "avg" | "days";
type AllSort = "avg" | "days" | "total" | "best";

function Name({ avatarId, name }: { avatarId: string; name: string }) {
  return (
    <span className="flex items-center gap-2">
      <Avatar id={avatarId} size="sm" label="" /> {name}
    </span>
  );
}

/** Column header that links to the same page sorted by that column. */
function SortTh({ label, active, href }: { label: string; active: boolean; href: string }) {
  return (
    <th className="text-right">
      <Link href={href} className={active ? "font-extrabold text-ink underline" : "underline decoration-dotted"} scroll={false}>
        {label}
        {active ? " ▼" : ""}
      </Link>
    </th>
  );
}

function DayTable({ board }: { board: Board }) {
  if (board.top.length === 0) return <p className="text-ink-soft">Nobody has finished yet.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-ink-soft">
        <tr>
          <th className="w-12 py-1">Rank</th>
          <th>Player</th>
          <th className="text-right">Score</th>
        </tr>
      </thead>
      <tbody>
        {board.top.map((r) => (
          <tr key={r.playerId} className="border-t border-line">
            <td className="py-1.5 font-bold tabular-nums">{r.rank}</td>
            <td><Name avatarId={r.avatarId} name={r.name} /></td>
            <td className="text-right font-bold tabular-nums">{formatPoints(r.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function sortWeek(rows: BoardRow[], sort: WeekSort): BoardRow[] {
  if (sort === "total") return rows;
  const key = (r: BoardRow) => (sort === "avg" ? (r.average ?? 0) : (r.daysPlayed ?? 0));
  return [...rows].sort((a, b) => key(b) - key(a) || a.rank - b.rank);
}

function WeekTable({ board, sort, link }: { board: Board; sort: WeekSort; link: (s: WeekSort) => string }) {
  if (board.top.length === 0) return <p className="text-ink-soft">Nobody played this week yet.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-ink-soft">
        <tr>
          <th className="w-12 py-1">Rank</th>
          <th>Player</th>
          <SortTh label="Days" active={sort === "days"} href={link("days")} />
          <SortTh label="Avg/day" active={sort === "avg"} href={link("avg")} />
          <SortTh label="Best-5 total" active={sort === "total"} href={link("total")} />
        </tr>
      </thead>
      <tbody>
        {sortWeek(board.top, sort).map((r) => (
          <tr key={r.playerId} className="border-t border-line">
            <td className="py-1.5 font-bold tabular-nums">{r.rank}</td>
            <td><Name avatarId={r.avatarId} name={r.name} /></td>
            <td className="text-right tabular-nums">{r.daysPlayed}</td>
            <td className="text-right tabular-nums">{r.average !== undefined ? formatPoints(r.average) : "—"}</td>
            <td className="text-right font-bold tabular-nums">{formatPoints(r.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function sortAll(rows: AllTimeRow[], sort: AllSort): AllTimeRow[] {
  const key = (r: AllTimeRow) => (sort === "avg" ? r.average : sort === "days" ? r.daysPlayed : sort === "best" ? r.best : r.total);
  return [...rows].sort((a, b) => key(b) - key(a) || b.average - a.average);
}

const MEDALS = ["🥇", "🥈", "🥉"];

export default async function AdminLeaderboard(props: PageProps<"/admin/leaderboard">) {
  const sp = await props.searchParams;
  const t = today();
  const raw = typeof sp.date === "string" ? sp.date : t;
  const date = isGameDate(raw) && raw <= t ? raw : t;
  const weekSort: WeekSort = sp.wsort === "avg" || sp.wsort === "days" ? sp.wsort : "total";
  const allSort: AllSort = sp.asort === "days" || sp.asort === "total" || sp.asort === "best" ? sp.asort : "avg";
  const [day, week, champions, allTime] = await Promise.all([
    dailyBoard(NOBODY, date, 200),
    weeklyBoard(NOBODY, date, 200),
    pastWeeks(NOBODY, 12),
    allTimeStats(),
  ]);
  // Private claim codes for each finished week's top 3 (created on first view).
  const codes = new Map<string, string>();
  for (const w of champions) for (const c of await ensurePrizeCodes(w.weekStart)) codes.set(`${w.weekStart}:${c.playerId}`, c.code);

  const href = (over: Record<string, string>) => {
    const q = new URLSearchParams();
    const merged = { date: date === t ? "" : date, wsort: weekSort === "total" ? "" : weekSort, asort: allSort === "avg" ? "" : allSort, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `?${s}` : "?";
  };
  const prevWeek = addDays(week.weekStart!, -7);
  const nextWeek = addDays(week.weekStart!, 7);
  const btn = "rounded-lg border border-line px-3 py-1.5 font-semibold";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-extrabold">Leaderboard</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link className={btn} href={href({ date: addDays(date, -1) })}>‹ Previous day</Link>
          <span className="font-semibold">{formatGameDate(date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</span>
          {date < t && <Link className={btn} href={href({ date: addDays(date, 1) })}>Next day ›</Link>}
          {date !== t && <Link className="underline" href={href({ date: "" })}>Today</Link>}
        </div>
      </div>
      <p className="text-sm text-ink-soft">
        Same rankings players see: finished games only, ties share a rank, weekly = best 5 days (Monday–Sunday, New York time). Avg/day averages every day
        played. Click a column to sort; the rank column keeps the official order.
      </p>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title={`Day · ${day.totalPlayers} finished`}>
          <DayTable board={day} />
        </Panel>
        <Panel
          title={`Week of ${formatGameDate(week.weekStart!)} · ${week.totalPlayers} players${week.final ? " · Final" : ""}`}
          actions={
            <span className="flex gap-2 text-sm">
              <Link className={btn} href={href({ date: prevWeek })}>‹ Week</Link>
              {nextWeek <= t && <Link className={btn} href={href({ date: nextWeek })}>Week ›</Link>}
            </span>
          }
        >
          <WeekTable board={week} sort={weekSort} link={(s) => href({ wsort: s === "total" ? "" : s })} />
        </Panel>
      </div>

      <Panel title="Past champions (top 3 of each finished week)">
        <p className="mb-3 text-sm text-ink-soft">
          From the week of Nov 16 on, each top-3 finisher sees a private prize code on their home screen. To check a prize claim, ask for the code and match it here.
        </p>
        {champions.length === 0 ? (
          <p className="text-ink-soft">No finished weeks yet. The first one locks in after Sunday ends (New York time).</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {champions.map((w) => (
              <div key={w.weekStart} className="rounded-xl border border-line p-3">
                <p className="text-sm font-bold">
                  <Link className="underline" href={href({ date: w.weekStart })}>
                    {formatGameDate(w.weekStart)} – {formatGameDate(w.weekEnd)}
                  </Link>{" "}
                  <span className="font-normal text-ink-soft">· {w.players} players</span>
                </p>
                <ol className="mt-2 space-y-1 text-sm">
                  {w.podium.map((r) => (
                    <li key={r.playerId} className="flex items-center gap-2">
                      <span className="w-5">{MEDALS[r.rank - 1]}</span>
                      <span className="min-w-0 flex-1 truncate">{r.name}</span>
                      <span className="tabular-nums text-ink-soft">{r.daysPlayed}d · avg {formatPoints(r.average ?? 0)}</span>
                      <span className="w-14 text-right font-bold tabular-nums">{formatPoints(r.total)}</span>
                      {codes.get(`${w.weekStart}:${r.playerId}`) && (
                        <code className="rounded bg-paper px-1.5 py-0.5 text-xs font-bold tracking-wider" title="Prize claim code — only this player sees it">
                          {codes.get(`${w.weekStart}:${r.playerId}`)}
                        </code>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title={`All time · ${allTime.length} players`}>
        {allTime.length === 0 ? (
          <p className="text-ink-soft">Nobody has finished a day yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-ink-soft">
                <tr>
                  <th className="py-1">Player</th>
                  <SortTh label="Days" active={allSort === "days"} href={href({ asort: "days" })} />
                  <SortTh label="Avg/day" active={allSort === "avg"} href={href({ asort: "" })} />
                  <SortTh label="Best day" active={allSort === "best"} href={href({ asort: "best" })} />
                  <SortTh label="Total" active={allSort === "total"} href={href({ asort: "total" })} />
                  <th className="text-right">Last played</th>
                </tr>
              </thead>
              <tbody>
                {sortAll(allTime, allSort).map((r) => (
                  <tr key={r.playerId} className="border-t border-line">
                    <td className="py-1.5"><Name avatarId={r.avatarId} name={r.name} /></td>
                    <td className="text-right tabular-nums">{r.daysPlayed}</td>
                    <td className="text-right font-bold tabular-nums">{formatPoints(r.average)}</td>
                    <td className="text-right tabular-nums">{formatPoints(r.best)}</td>
                    <td className="text-right tabular-nums">{formatPoints(r.total)}</td>
                    <td className="text-right text-ink-soft">{formatGameDate(r.lastPlayed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
