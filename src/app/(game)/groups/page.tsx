"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Onboarding } from "@/components/Onboarding";
import { CenterMessage, Shell, Spinner } from "@/components/Shell";
import { api } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { GROUP_ADJECTIVES, GROUP_NOUNS, suggestGroupLabel } from "@/lib/names";

interface GroupLite {
  id: string;
  label: string;
  memberCount: number;
  isOwner: boolean;
}

export default function GroupsPage() {
  const { status, me } = useSession();
  if (status === "loading") return <Shell><Spinner /></Shell>;
  if (!me) return <Shell hideNav><Onboarding /></Shell>;
  return <Shell><Groups /></Shell>;
}

function Groups() {
  const router = useRouter();
  const [groups, setGroups] = useState<GroupLite[] | null>(null);
  const [label, setLabel] = useState(() => suggestGroupLabel());
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ groups: GroupLite[] }>("/api/groups").then((r) => setGroups(r.groups)).catch((e) => setError(e.message));
  }, []);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ group: GroupLite }>("/api/groups", { body: label });
      router.push(`/groups/${r.group.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  };

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ group: GroupLite }>("/api/groups/join", { body: { code } });
      router.push(`/groups/${r.group.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  };

  if (!groups && !error) return <Spinner />;
  const selectCls = "min-h-12 w-full rounded-xl border-2 border-line bg-card px-3 text-lg font-bold";

  return (
    <div className="space-y-5">
      <h1 className="font-display text-3xl font-extrabold">Groups</h1>
      {error && <p role="alert" className="rounded-xl bg-coral-soft p-3 font-semibold text-coral">{error}</p>}
      {groups && groups.length > 0 ? (
        <ul className="card divide-y divide-line px-5">
          {groups.map((g) => (
            <li key={g.id}>
              <Link href={`/groups/${g.id}`} className="flex min-h-14 items-center justify-between py-3 text-lg font-bold">
                <span>{g.label}{g.isOwner && <span className="ml-2 chip">owner</span>}</span>
                <span className="text-base font-semibold text-ink-soft">{g.memberCount} ›</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        groups && <CenterMessage title="No groups yet">Groups are private. Only people with your invite code can join.</CenterMessage>
      )}

      <section className="card space-y-3 p-5" aria-labelledby="create-heading">
        <h2 id="create-heading" className="font-display text-xl font-extrabold">Start a group</h2>
        <p className="text-base text-ink-soft">Group names come from a word list so they&apos;re friendly for everyone.</p>
        <p className="font-display text-2xl font-extrabold">The {label.adjective} {label.noun}</p>
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="sr-only">First word</span>
            <select className={selectCls} value={label.adjective} onChange={(e) => setLabel({ ...label, adjective: e.target.value })}>
              {GROUP_ADJECTIVES.map((w) => <option key={w}>{w}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Second word</span>
            <select className={selectCls} value={label.noun} onChange={(e) => setLabel({ ...label, noun: e.target.value })}>
              {GROUP_NOUNS.map((w) => <option key={w}>{w}</option>)}
            </select>
          </label>
        </div>
        <button type="button" className="btn-ghost" onClick={() => setLabel(suggestGroupLabel())}>🎲 Surprise me</button>
        <button type="button" className="btn-primary w-full" disabled={busy} onClick={create}>Create group</button>
      </section>

      <form className="card space-y-3 p-5" onSubmit={join} aria-labelledby="join-heading">
        <h2 id="join-heading" className="font-display text-xl font-extrabold">Join with a code</h2>
        <label className="block">
          <span className="label">Invite code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 12))}
            className="mt-1 min-h-12 w-full rounded-xl border-2 border-line bg-card px-3 font-mono text-2xl tracking-[0.3em] uppercase"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            placeholder="ABCD2345"
          />
        </label>
        <button type="submit" className="btn-ink w-full" disabled={busy || code.replace(/[^A-Z0-9]/gi, "").length !== 8}>Join group</button>
      </form>
    </div>
  );
}
