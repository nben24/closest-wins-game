"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Onboarding } from "@/components/Onboarding";
import { CenterMessage, Shell, Spinner } from "@/components/Shell";
import { api } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { formatPoints } from "@/lib/format";
import { formatGameDate } from "@/lib/time";

interface Row {
  date: string;
  number: number;
  total: number;
  status: string;
  isDemo: boolean;
}

export default function HistoryPage() {
  const { status, me } = useSession();
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (me) api<{ history: Row[] }>("/api/history").then((r) => setRows(r.history)).catch(() => setRows([]));
  }, [me]);
  if (status === "loading") return <Shell><Spinner /></Shell>;
  if (!me) return <Shell hideNav><Onboarding /></Shell>;
  const done = rows?.filter((r) => r.status === "completed") ?? [];
  const avg = done.length ? Math.round(done.reduce((s, r) => s + r.total, 0) / done.length) : null;
  const best = done.length ? Math.max(...done.map((r) => r.total)) : null;
  return (
    <Shell>
      <h1 className="font-display text-3xl font-extrabold">History</h1>
      <p className="mt-1 text-base text-ink-soft">Saved on this browser for {me.name}.</p>
      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <CenterMessage title="No games yet"><Link href="/play" className="btn-primary mt-3">Play today</Link></CenterMessage>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            {[
              ["Played", String(done.length)],
              ["Average", avg !== null ? formatPoints(avg) : "—"],
              ["Best", best !== null ? formatPoints(best) : "—"],
            ].map(([k, v]) => (
              <div key={k} className="card p-3">
                <p className="label">{k}</p>
                <p className="font-display text-2xl font-extrabold tabular-nums">{v}</p>
              </div>
            ))}
          </div>
          <ul className="card mt-4 divide-y divide-line px-5">
            {rows.map((r) => (
              <li key={r.date}>
                <Link href={`/results?date=${r.date}`} className="flex min-h-14 items-center justify-between py-3">
                  <span>
                    <span className="block text-lg font-bold">#{r.number} · {formatGameDate(r.date, { weekday: "short", month: "short", day: "numeric" })}</span>
                  </span>
                  <span className="font-display text-xl font-extrabold tabular-nums">
                    {r.status === "completed" ? formatPoints(r.total) : "unfinished"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Shell>
  );
}
