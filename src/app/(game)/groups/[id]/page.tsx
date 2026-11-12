"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Onboarding } from "@/components/Onboarding";
import { ShareButton } from "@/components/ShareButton";
import { CenterMessage, Shell, Spinner } from "@/components/Shell";
import { GAME_TITLE } from "@/config/game";
import { api } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { formatPoints } from "@/lib/format";
import { formatGameDate } from "@/lib/time";
import type { GroupDetail } from "@/lib/server/groups";

export default function GroupPage() {
  const { status, me } = useSession();
  if (status === "loading") return <Shell><Spinner /></Shell>;
  if (!me) return <Shell hideNav><Onboarding /></Shell>;
  return <Shell><Group /></Shell>;
}

function Group() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [g, setG] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"today" | "week">("today");

  const load = useCallback(() => {
    api<{ group: GroupDetail }>(`/api/groups/${id}`).then((r) => setG(r.group)).catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  if (error) return <CenterMessage title="Group not available">{error}<br /><Link href="/groups" className="btn-soft mt-3">Back to groups</Link></CenterMessage>;
  if (!g) return <Spinner />;

  const link = typeof window !== "undefined" ? `${window.location.origin}/join/${g.inviteCode}` : "";
  const inviteText = `Join "${g.label}" on ${GAME_TITLE} — five number questions a day, closest guess wins.\n${link}`;

  const leave = async () => {
    if (!confirm(`Leave ${g.label}?`)) return;
    await api(`/api/groups/${g.id}`, { method: "DELETE" });
    router.push("/groups");
  };
  const remove = async (playerId: string, name: string) => {
    if (!confirm(`Remove ${name} from the group?`)) return;
    await api(`/api/groups/${g.id}/members/${playerId}`, { method: "DELETE" });
    load();
  };
  const rotate = async () => {
    if (!confirm("Make a new invite code? The old code and link will stop working.")) return;
    await api(`/api/groups/${g.id}/invite`, { method: "POST" });
    load();
  };

  return (
    <div className="space-y-5">
      <div>
        <Link href="/groups" className="btn-ghost -ml-3">‹ Groups</Link>
        <h1 className="font-display text-3xl font-extrabold">{g.label}</h1>
        <p className="text-base text-ink-soft">{g.members.length} players · private</p>
      </div>

      <div className="flex gap-2 rounded-2xl bg-card p-1 ring-2 ring-line" role="tablist" aria-label="Standings">
        {(["today", "week"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`min-h-11 flex-1 rounded-xl text-base font-bold ${tab === t ? "bg-primary text-primary-fg" : "text-ink-soft"}`}
            onClick={() => setTab(t)}
          >
            {t === "today" ? `Today · ${formatGameDate(g.date)}` : "This week"}
          </button>
        ))}
      </div>

      {tab === "today" ? (
        <section className="card p-5" aria-label="Today's standings">
          {g.daily.length === 0 ? (
            <p className="text-lg text-ink-soft">Nobody has finished today&apos;s challenge yet.</p>
          ) : (
            <ol className="divide-y divide-line">
              {g.daily.map((s) => (
                <li key={s.playerId} className={`flex items-center gap-3 py-2.5 ${s.isViewer ? "font-bold" : ""}`}>
                  <span className="w-7 text-right font-display text-xl font-extrabold tabular-nums">{s.rank}</span>
                  <Avatar id={s.avatarId} size="sm" label="" />
                  <span className="flex-1 truncate text-lg">{s.isViewer ? `${s.name} (you)` : s.name}</span>
                  <span className="text-lg tabular-nums">{formatPoints(s.total)}</span>
                </li>
              ))}
            </ol>
          )}
          {g.notFinished.length > 0 && (
            <p className="mt-3 text-base text-ink-soft">Still to play: {g.notFinished.map((m) => m.name).join(", ")}</p>
          )}
        </section>
      ) : (
        <section className="card p-5" aria-label="Weekly standings">
          <p className="text-base text-ink-soft">
            Monday {formatGameDate(g.weekStart)} – Sunday. Each player&apos;s best 5 days count.
          </p>
          {g.weekly.length === 0 ? (
            <p className="mt-3 text-lg text-ink-soft">No finished games this week yet.</p>
          ) : (
            <ol className="mt-2 divide-y divide-line">
              {g.weekly.map((s) => (
                <li key={s.playerId} className={`flex items-center gap-3 py-2.5 ${s.isViewer ? "font-bold" : ""}`}>
                  <span className="w-7 text-right font-display text-xl font-extrabold tabular-nums">{s.rank}</span>
                  <Avatar id={s.avatarId} size="sm" label="" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg">{s.isViewer ? `${s.name} (you)` : s.name}</span>
                    <span className="block text-sm font-normal text-ink-soft">
                      {s.daysCounted} of 5 days counted{s.daysPlayed > s.daysCounted ? ` (played ${s.daysPlayed})` : ""}
                    </span>
                  </span>
                  <span className="text-lg tabular-nums">{formatPoints(s.total)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      <section className="card space-y-3 p-5" aria-labelledby="invite-heading">
        <h2 id="invite-heading" className="font-display text-xl font-extrabold">Invite people</h2>
        <p className="text-base text-ink-soft">Anyone with this code can join. Only share it with people you know.</p>
        <p className="rounded-xl bg-paper py-3 text-center font-mono text-3xl font-bold tracking-[0.25em]" aria-label={`Invite code ${g.inviteCode.split("").join(" ")}`}>
          {g.inviteCode}
        </p>
        <ShareButton text={inviteText} label="Share invite" />
        {g.isOwner && <button type="button" className="btn-ghost" onClick={rotate}>Make a new code</button>}
      </section>

      <section className="card p-5" aria-labelledby="members-heading">
        <h2 id="members-heading" className="font-display text-xl font-extrabold">Players</h2>
        <ul className="mt-2 divide-y divide-line">
          {g.members.map((m) => (
            <li key={m.playerId} className="flex min-h-12 items-center gap-3 py-2">
              <Avatar id={m.avatarId} size="sm" label="" />
              <span className="flex-1 truncate text-lg">{m.name}{m.isViewer ? " (you)" : ""}{m.role === "owner" && <span className="ml-2 chip">owner</span>}</span>
              {g.isOwner && !m.isViewer && (
                <button type="button" className="btn-ghost text-coral" onClick={() => remove(m.playerId, m.name)} aria-label={`Remove ${m.name}`}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <button type="button" className="btn-soft w-full" onClick={leave}>Leave group</button>
    </div>
  );
}
