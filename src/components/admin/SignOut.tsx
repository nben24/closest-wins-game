"use client";

import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { supabaseBrowser, supabaseConfigured } from "@/lib/supabase/browser";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="rounded-lg border border-line px-2 py-1 font-semibold"
      onClick={async () => {
        if (supabaseConfigured) await supabaseBrowser()!.auth.signOut();
        await api("/api/admin/logout", { method: "POST", body: {} }).catch(() => {});
        router.push("/admin/login");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
