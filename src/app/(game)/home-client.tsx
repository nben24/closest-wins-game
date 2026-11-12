"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Onboarding } from "@/components/Onboarding";
import { CenterMessage, Shell, Spinner } from "@/components/Shell";
import { MAX_POINTS_PER_DAY } from "@/config/game";
import { api } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { formatPoints } from "@/lib/format";
import { formatGameDate, nextGameDayStart } from "@/lib/time";

interface StateLite {
  serverNow: string;
  challenge: { id: string; date: string; number: number; isDemo: boolean } | null;
  attempt: { status: string; totalScore: number; roundsFinished: number } | null;
}

interface GroupLite {
  id: string;
  label: string;
  memberCount: number;
}

function useCountdown(target: Date | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!target) return null;
  const ms = Math.max(0, target.getTime() - now);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

export function HomeClient() {
  const { status, me, error } = useSession();
  if (status === "loading") return <Shell><Spinner /></Shell>;
  if (status === "error") return <Shell><CenterMessage title="Can't load the game">{error}</CenterMessage></Shell>;
  if (!me) return <Shell hideNav><Onboarding /></Shell>;
  return <Shell><Today name={me.name} /></Shell>;
}

function Today({ name }: { name: string }) {
  const [state, setState] = useState<StateLite | null>(null);
  const [groups, setGroups] = useState<GroupLite[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<StateLite>("/api/play/state").then(setState).catch((e) => setErr(e.message));
    api<{ groups: GroupLite[] }>("/api/groups").then((r) => setGroups(r.groups)).catch(() => setGroups([]));
  }, []);
  const countdown = useCountdown(state ? nextGameDayStart(new Date(state.serverNow)) : null);

  if (err) return <CenterMessage title="Something went wrong">{err}</CenterMessage>;
  if (!state) return <Spinner />;

  const ch = state.challenge;
  const a = state.attempt;
  return (
    <div className="space-y-5">
      <p className="text-lg text-ink-soft">
        Hi, <span className="font-bold text-ink">{name}</span> 👋
      </p>
      {!ch ? (
        <CenterMessage title="Today's challenge isn't ready yet">
          The questions are still being prepared. Please check back a little later.
        </CenterMessage>
      ) : (
        <section className="card relative overflow-hidden p-6" aria-labelledby="today-heading">
          <div aria-hidden="true" className="absolute -top-10 -right-10 h-36 w-36 rounded-full bg-sun/40" />
          <p className="label relative">{formatGameDate(ch.date, { weekday: "long", month: "long", day: "numeric" })}</p>
          <h1 id="today-heading" className="relative mt-1 font-display text-4xl font-extrabold tracking-tight">
            Challenge #{ch.number}
          </h1>
          {ch.isDemo && (
            <p className="relative mt-2 inline-block rounded-full bg-plum-soft px-3 py-1 text-sm font-bold text-plum">
              Demo questions · not verified
            </p>
          )}
          {!a && (
            <>
              <p className="relative mt-3 text-lg text-ink-soft">Five questions. Closest guess wins.</p>
              <Link href="/play" className="btn-primary relative mt-5 w-full text-xl">
                Play today&apos;s five
              </Link>
              <Link href="/practice" className="btn-soft relative mt-3 w-full">
                Try a practice question first
              </Link>
            </>
          )}
          {a && a.status !== "completed" && (
            <>
              <p className="relative mt-3 text-lg text-ink-soft">You&apos;ve finished {a.roundsFinished} of 5.</p>
              <Link href="/play" className="btn-primary relative mt-5 w-full text-xl">
                Continue
              </Link>
            </>
          )}
          {a && a.status === "completed" && (
            <>
              <p className="relative mt-3 font-display text-5xl font-extrabold tabular-nums">
                {formatPoints(a.totalScore)}
                <span className="text-xl text-ink-soft"> / {formatPoints(MAX_POINTS_PER_DAY)}</span>
              </p>
              <Link href="/results" className="btn-primary relative mt-5 w-full text-xl">
                See results & share
              </Link>
              {countdown && <p className="relative mt-3 text-center text-base text-ink-soft">Next challenge in {countdown}</p>}
            </>
          )}
        </section>
      )}

      <section className="card p-5" aria-labelledby="groups-heading">
        <div className="flex items-center justify-between">
          <h2 id="groups-heading" className="font-display text-xl font-extrabold">Your groups</h2>
          <Link href="/groups" className="btn-ghost">Manage</Link>
        </div>
        {groups === null ? null : groups.length === 0 ? (
          <p className="mt-2 text-base text-ink-soft">Play against friends and family in a private group.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {groups.map((g) => (
              <li key={g.id}>
                <Link href={`/groups/${g.id}`} className="flex min-h-12 items-center justify-between py-2 text-lg font-semibold">
                  {g.label}
                  <span className="text-sm text-ink-soft">{g.memberCount} players ›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-center">
        <Link href="/about" className="btn-ghost">How scoring works</Link>
      </p>
    </div>
  );
}
