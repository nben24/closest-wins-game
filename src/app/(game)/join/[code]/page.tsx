"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { IdentityPicker } from "@/components/Onboarding";
import { CenterMessage, Shell, Spinner } from "@/components/Shell";
import { GAME_TAGLINE, GAME_TITLE } from "@/config/game";
import { api } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";

export default function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const { status, me, setMe } = useSession();
  const [preview, setPreview] = useState<{ label: string; memberCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ group: { label: string; memberCount: number } }>(`/api/invites/${encodeURIComponent(code)}`)
      .then((r) => setPreview(r.group))
      .catch((e) => setError(e.message));
  }, [code]);

  const join = async () => {
    setBusy(true);
    try {
      const r = await api<{ group: { id: string } }>("/api/groups/join", { body: { code } });
      router.push(`/groups/${r.group.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  };

  if (status === "loading" || (!preview && !error)) return <Shell hideNav><Spinner /></Shell>;
  if (error && !preview) return <Shell hideNav><CenterMessage title="Invite not found">{error}</CenterMessage></Shell>;

  return (
    <Shell hideNav>
      <div className="space-y-5">
        <section className="card p-6 text-center">
          <p className="label">You&apos;re invited to</p>
          <h1 className="mt-1 font-display text-3xl font-extrabold">{preview!.label}</h1>
          <p className="mt-1 text-base text-ink-soft">{preview!.memberCount} players on {GAME_TITLE}</p>
          <p className="mt-3 text-lg">{GAME_TAGLINE}</p>
        </section>
        {error && <p role="alert" className="rounded-xl bg-coral-soft p-3 font-semibold text-coral">{error}</p>}
        {me ? (
          <button type="button" className="btn-primary w-full text-xl" disabled={busy} onClick={join}>
            Join as {me.name}
          </button>
        ) : (
          <>
            <h2 className="font-display text-2xl font-extrabold">First, pick your player</h2>
            <IdentityPicker
              cta="Join group"
              onDone={async (m) => {
                setMe(m);
                await join();
              }}
            />
          </>
        )}
      </div>
    </Shell>
  );
}
