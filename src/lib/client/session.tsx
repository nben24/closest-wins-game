"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/client/api";
import { supabaseBrowser, supabaseConfigured } from "@/lib/supabase/browser";

export interface Me {
  id: string;
  name: string;
  avatarId: string;
  adjective: string;
  noun: string;
}

interface MeResponse {
  mode: "supabase" | "local";
  hasIdentity: boolean;
  isAnonymous: boolean;
  player: Me | null;
}

interface SessionValue {
  status: "loading" | "ready" | "error";
  me: Me | null;
  mode: "supabase" | "local" | null;
  error: string | null;
  refresh: () => Promise<void>;
  /** Make sure this browser has an (anonymous) identity. */
  ensureIdentity: () => Promise<void>;
  setMe: (me: Me) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export async function ensureIdentity(): Promise<void> {
  if (supabaseConfigured) {
    const supabase = supabaseBrowser()!;
    const { data } = await supabase.auth.getSession();
    if (data.session) return;
    const { error } = await supabase.auth.signInAnonymously();
    if (error) {
      console.error("Supabase anonymous sign-in failed:", error);
      throw new Error(`Couldn't start a guest session (${error.message || "unknown error"}).`);
    }
    return;
  }
  await api("/api/session", { method: "POST", body: {} });
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionValue["status"]>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [mode, setMode] = useState<SessionValue["mode"]>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api<MeResponse>("/api/me");
      setMe(r.player);
      setMode(r.mode);
      setStatus("ready");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void refresh();
  }, [refresh]);

  return (
    <SessionContext.Provider value={{ status, me, mode, error, refresh, ensureIdentity, setMe }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
