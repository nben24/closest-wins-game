/**
 * Normalize a Supabase project URL. People often paste the REST endpoint
 * (https://xxxx.supabase.co/rest/v1/) — supabase-js needs the bare origin.
 */
export function normalizeSupabaseUrl(raw: string | undefined): string | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  return v.replace(/\/+(rest|auth|storage|realtime|functions)\/v1\/?.*$/i, "").replace(/\/+$/, "");
}
