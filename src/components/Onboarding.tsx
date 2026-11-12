"use client";

import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { LogoMark } from "@/components/Logo";
import { GAME_TAGLINE, GAME_TITLE } from "@/config/game";
import { api, ApiClientError } from "@/lib/client/api";
import { useSession, type Me } from "@/lib/client/session";
import { AVATARS, NAME_ADJECTIVES, NAME_NOUNS, isCombinationAllowed, suggestIdentity } from "@/lib/names";

/** Pick an avatar and a nickname from approved lists — or accept the suggestion. */
export function IdentityPicker({ initial, onDone, cta }: { initial?: Partial<Me>; onDone: (me: Me) => void; cta: string }) {
  const { ensureIdentity } = useSession();
  const [pick, setPick] = useState(() => {
    const s = suggestIdentity();
    return { avatarId: initial?.avatarId ?? s.avatarId, adjective: initial?.adjective ?? s.adjective, noun: initial?.noun ?? s.noun };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shuffle = () => {
    const s = suggestIdentity();
    setPick({ ...pick, adjective: s.adjective, noun: s.noun });
  };
  const valid = isCombinationAllowed(pick.adjective, pick.noun);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await ensureIdentity();
      const r = await api<{ player: Me }>("/api/profile", { body: pick });
      onDone(r.player);
    } catch (e) {
      setError(e instanceof ApiClientError || e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const selectCls = "min-h-12 w-full rounded-xl border-2 border-line bg-card px-3 text-lg font-bold";

  return (
    <div className="space-y-5">
      <div className="card flex items-center gap-4 p-4">
        <Avatar id={pick.avatarId} size="lg" />
        <div className="min-w-0">
          <p className="label">You&apos;ll appear as</p>
          <p className="truncate font-display text-2xl font-extrabold">
            {pick.adjective} {pick.noun}
          </p>
          <p className="text-sm text-ink-soft">A number is added if the name is taken.</p>
        </div>
      </div>

      <fieldset>
        <legend className="label mb-2">Avatar</legend>
        <div className="grid grid-cols-6 gap-2" role="radiogroup" aria-label="Avatar">
          {AVATARS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={pick.avatarId === a.id}
              aria-label={a.label}
              onClick={() => setPick({ ...pick, avatarId: a.id })}
              className={`flex aspect-square items-center justify-center rounded-2xl text-2xl ${pick.avatarId === a.id ? "ring-4 ring-ink" : "ring-1 ring-line"}`}
              style={{ background: a.bg }}
            >
              <span aria-hidden="true">{a.emoji}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="label mb-2">Nickname</legend>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="sr-only">First word</span>
            <select className={selectCls} value={pick.adjective} onChange={(e) => setPick({ ...pick, adjective: e.target.value })}>
              {NAME_ADJECTIVES.map((w) => (
                <option key={w}>{w}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="sr-only">Second word</span>
            <select className={selectCls} value={pick.noun} onChange={(e) => setPick({ ...pick, noun: e.target.value })}>
              {NAME_NOUNS.map((w) => (
                <option key={w}>{w}</option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" className="btn-ghost mt-1" onClick={shuffle}>
          🎲 Surprise me
        </button>
        {!valid && <p className="text-base font-semibold text-coral">That combination isn&apos;t available — try another.</p>}
      </fieldset>

      {error && (
        <p role="alert" className="rounded-xl bg-coral-soft p-3 font-semibold text-coral">
          {error}
        </p>
      )}
      <button type="button" className="btn-primary w-full text-xl" disabled={busy || !valid} onClick={save}>
        {busy ? "Saving…" : cta}
      </button>
    </div>
  );
}

export function Onboarding() {
  const { setMe } = useSession();
  return (
    <div className="space-y-6">
      <div className="text-center">
        <LogoMark className="mx-auto h-16 w-16" />
        <h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight">{GAME_TITLE}</h1>
        <p className="mt-2 text-xl text-ink-soft">{GAME_TAGLINE}</p>
      </div>
      <ol className="card grid gap-3 p-5 text-lg">
        <li className="flex gap-3">
          <span aria-hidden="true">📖</span> 4 seconds to read each question.
        </li>
        <li className="flex gap-3">
          <span aria-hidden="true">⏱️</span> 10 seconds to guess a number.
        </li>
        <li className="flex gap-3">
          <span aria-hidden="true">🎯</span> No need to be exact — closer earns more, up to 1,000 points.
        </li>
      </ol>
      <h2 className="font-display text-2xl font-extrabold">Pick your player</h2>
      <IdentityPicker onDone={setMe} cta="Let's play" />
      <p className="text-center text-sm text-ink-soft">
        No email or password. Your history is saved on this browser only.
      </p>
    </div>
  );
}
