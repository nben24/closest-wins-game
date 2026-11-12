"use client";
import { createBrowserClient } from "@supabase/ssr";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && key);

let client: ReturnType<typeof createBrowserClient> | null = null;

export function supabaseBrowser() {
  if (!supabaseConfigured) return null;
  client ??= createBrowserClient(url!, key!);
  return client;
}
