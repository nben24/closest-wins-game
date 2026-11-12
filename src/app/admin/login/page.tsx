"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Wordmark } from "@/components/Logo";
import { api } from "@/lib/client/api";
import { supabaseBrowser, supabaseConfigured } from "@/lib/supabase/browser";

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (supabaseConfigured) {
        const { error } = await supabaseBrowser()!.auth.signInWithPassword({ email, password });
        if (error) throw new Error("Sign-in failed. Check your email and password.");
      } else {
        await api("/api/admin/local-login", { body: { password } });
      }
      router.push("/admin");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const input = "mt-1 min-h-11 w-full rounded-xl border-2 border-line bg-card px-3 text-base";
  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <Wordmark />
      <h1 className="mt-6 font-display text-2xl font-extrabold">Admin sign in</h1>
      {!supabaseConfigured && (
        <p className="mt-2 rounded-xl bg-sun-soft p-3 text-sm">
          Local development mode. Use the <code>LOCAL_ADMIN_PASSWORD</code> from <code>.env.local</code>. This login is disabled when Supabase is configured or
          on Vercel.
        </p>
      )}
      <form onSubmit={submit} className="mt-4 space-y-3">
        {supabaseConfigured && (
          <label className="block text-sm font-bold">
            Email
            <input className={input} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
        )}
        <label className="block text-sm font-bold">
          Password
          <input className={input} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p role="alert" className="text-sm font-semibold text-coral">{error}</p>}
        <button className="btn-ink w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <p className="mt-6 text-sm text-ink-soft">Signing in here replaces this browser&apos;s guest player session.</p>
    </main>
  );
}
