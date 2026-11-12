"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { IdentityPicker, Onboarding } from "@/components/Onboarding";
import { Shell, Spinner } from "@/components/Shell";
import { setSoundEnabled, soundEnabled } from "@/lib/client/sound";
import { useSession } from "@/lib/client/session";

export default function ProfilePage() {
  const { status, me, setMe } = useSession();
  const [sound, setSound] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read local preference
    setSound(soundEnabled());
  }, []);
  if (status === "loading") return <Shell><Spinner /></Shell>;
  if (!me) return <Shell hideNav><Onboarding /></Shell>;
  return (
    <Shell>
      <div className="space-y-6">
        <h1 className="font-display text-3xl font-extrabold">Your player</h1>
        <IdentityPicker
          key={me.id}
          initial={me}
          cta="Save changes"
          onDone={(m) => {
            setMe(m);
            setSaved(true);
          }}
        />
        {saved && <p role="status" className="text-center font-semibold text-mint">Saved!</p>}

        <section className="card space-y-3 p-5">
          <h2 className="font-display text-xl font-extrabold">Settings</h2>
          <label className="flex min-h-12 items-center justify-between gap-3 text-lg font-semibold">
            Sound effects
            <input
              type="checkbox"
              className="h-7 w-7 accent-coral"
              checked={sound}
              onChange={(e) => {
                setSound(e.target.checked);
                setSoundEnabled(e.target.checked);
              }}
            />
          </label>
        </section>

        <section className="card space-y-2 p-5 text-base">
          <h2 className="font-display text-xl font-extrabold">About your guest account</h2>
          <p>You play as a guest — no email, no password. Your scores and groups are tied to <strong>this browser</strong>.</p>
          <p className="text-ink-soft">
            If you clear this site&apos;s data, use private browsing, or switch devices, you&apos;ll start fresh as a new player.
          </p>
          <Link href="/about" className="btn-ghost -ml-3">Privacy & how it works</Link>
        </section>
      </div>
    </Shell>
  );
}
