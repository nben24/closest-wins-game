"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Onboarding } from "@/components/Onboarding";
import { CenterMessage, Shell, Spinner } from "@/components/Shell";
import { MAX_POINTS_PER_DAY } from "@/config/game";
import { api } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { formatPoints } from "@/lib/format";
import { formatGameDate, nextGameDayStart } from "@/lib/time";
import type { Leader, LeadersSummary } from "@/lib/server/leaderboard";

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

function LeaderLine({ icon, label, leader, href, extra }: { icon: string; label: string; leader: Leader; href: string; extra?: string }) {
  return (
    <li>
      <Link href={href} className="flex min-h-12 items-center gap-3 py-2">
        <span aria-hidden="true" className="w-6 text-center text-xl">{icon}</span>
        <Avatar id={leader.avatarId} size="sm" label="" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-ink-soft">{label}</span>
          <span className="block truncate text-lg font-semibold">
            {leader.isViewer ? "You!" : leader.name}
            {leader.tiedWith > 0 && <span className="text-base font-normal text-ink-soft"> +{leader.tiedWith} tied</span>}
          </span>
        </span>
        <span className="text-right">
          <span className="block font-display text-xl tabular-nums text-sun">{formatPoints(leader.total)}</span>
          {extra && <span className="block text-xs text-ink-soft">{extra}</span>}
        </span>
      </Link>
    </li>
  );
}

/** Who's leading today / this week, and last week's champion. Scores only — nothing about the answers. */
function Leaders({ data }: { data: LeadersSummary }) {
  const { today, week, lastWeek } = data;
  if (!today && !week && !lastWeek) return null;
  return (
    <section className="card px-5 py-3" aria-labelledby="leaders-heading">
      <h2 id="leaders-heading" className="sr-only">Who&apos;s leading</h2>
      <ul className="divide-y divide-line">
        {today ? (
          <LeaderLine icon="👑" label="Leading today" leader={today} href="/leaderboard" extra={`of ${today.players} played`} />
        ) : (
          <li className="flex min-h-12 items-center gap-3 py-2 text-base text-ink-soft">
            <span aria-hidden="true" className="w-6 text-center text-xl">👑</span>
            Nobody has finished today yet. Be the first!
          </li>
        )}
        {week && (
          <LeaderLine
            icon="🏆"
            label="Leading this week"
            leader={week}
            href="/leaderboard#week"
            extra={week.daysPlayed ? `${week.daysPlayed} day${week.daysPlayed === 1 ? "" : "s"}` : undefined}
          />
        )}
        {lastWeek && <LeaderLine icon="🥇" label="Last week's champion" leader={lastWeek} href="/leaderboard#week" />}
      </ul>
    </section>
  );
}

interface Prize {
  weekStart: string;
  rank: number;
  code: string;
}

const PLACE = ["", "1st", "2nd", "3rd"];

/** Shown only to a weekly top-3 finisher: their private claim code. */
function PrizeCard({ prize }: { prize: Prize }) {
  return (
    <section className="card border-sun p-5 text-center" aria-labelledby="prize-heading">
      <p className="text-4xl" aria-hidden="true">{prize.rank === 1 ? "🏆" : prize.rank === 2 ? "🥈" : "🥉"}</p>
      <h2 id="prize-heading" className="title mt-1 font-display text-2xl text-sun">
        You finished {PLACE[prize.rank]} last week!
      </h2>
      <p className="mt-2 text-base text-ink-soft">Your prize code (week of {formatGameDate(prize.weekStart)}):</p>
      <p className="mt-1 font-display text-4xl tracking-widest tabular-nums select-all">{prize.code}</p>
      <p className="mt-2 text-sm text-ink-soft">Only you can see this. Send it to the person who runs the game to claim a prize.</p>
    </section>
  );
}

function Today({ name }: { name: string }) {
  const [state, setState] = useState<StateLite | null>(null);
  const [groups, setGroups] = useState<GroupLite[] | null>(null);
  const [rank, setRank] = useState<{ rank: number; of: number } | null>(null);
  const [leaders, setLeaders] = useState<LeadersSummary | null>(null);
  const [prize, setPrize] = useState<Prize | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<StateLite>("/api/play/state").then(setState).catch((e) => setErr(e.message));
    api<{ groups: GroupLite[] }>("/api/groups").then((r) => setGroups(r.groups)).catch(() => setGroups([]));
    api<{ board: { totalPlayers: number; me: { rank: number } | null } }>("/api/leaderboard?scope=day")
      .then((r) => r.board.me && setRank({ rank: r.board.me.rank, of: r.board.totalPlayers }))
      .catch(() => {});
    api<{ leaders: LeadersSummary; prize: Prize | null }>("/api/leaderboard/summary")
      .then((r) => {
        setLeaders(r.leaders);
        setPrize(r.prize);
      })
      .catch(() => {});
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
      {prize && <PrizeCard prize={prize} />}
      {!ch ? (
        <CenterMessage title="Today's challenge isn't ready yet">
          The questions are still being prepared. Please check back a little later.
        </CenterMessage>
      ) : (
        <section className="card relative overflow-hidden p-6" aria-labelledby="today-heading">
          <p className="label relative">{formatGameDate(ch.date, { weekday: "long", month: "long", day: "numeric" })}</p>
          <h1 id="today-heading" className="title relative mt-1 font-display text-5xl font-extrabold tracking-tight text-sun">
            Challenge #{ch.number}
          </h1>
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
              {rank && (
                <p className="relative mt-1 text-lg">
                  <strong className="text-sun">#{rank.rank}</strong> of {rank.of} today ·{" "}
                  <Link href="/leaderboard" className="font-bold underline underline-offset-2">Leaderboard</Link>
                </p>
              )}
              <Link href="/results" className="btn-primary relative mt-5 w-full text-xl">
                See results & share
              </Link>
              {countdown && <p className="relative mt-3 text-center text-base text-ink-soft">Next challenge in {countdown}</p>}
            </>
          )}
        </section>
      )}

      {leaders && ch && <Leaders data={leaders} />}

      <section className="card p-5" aria-labelledby="groups-heading">
        <div className="flex items-center justify-between">
          <h2 id="groups-heading" className="title font-display text-xl font-extrabold">Your groups</h2>
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
