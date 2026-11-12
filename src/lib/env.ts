import { normalizeSupabaseUrl } from "@/lib/supabase/url";
/**
 * Server-side environment. Never import this from client components.
 *
 * Modes:
 *  - "supabase": NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 *    + DATABASE_URL are set. Anonymous Supabase Auth identifies players; the
 *    database is Supabase Postgres. Required for any deployment.
 *  - "local": nothing configured. An embedded Postgres (PGlite) under .data/
 *    and a signed local cookie identity. For development and demos only.
 */

export type AppMode = "supabase" | "local";

function clean(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

export const env = {
  get supabaseUrl() {
    return normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabasePublishableKey() {
    return clean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ?? clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  },
  /** DATABASE_URL, or POSTGRES_URL as set automatically by the Vercel ↔ Supabase integration. */
  get databaseUrl() {
    return clean(process.env.DATABASE_URL) ?? clean(process.env.POSTGRES_URL);
  },
  get databaseCaCert() {
    return clean(process.env.DATABASE_CA_CERT);
  },
  get localDbDir() {
    return clean(process.env.LOCAL_DB_DIR) ?? ".data/pglite";
  },
  get anthropicApiKey() {
    return clean(process.env.ANTHROPIC_API_KEY);
  },
  get anthropicModel() {
    return clean(process.env.ANTHROPIC_MODEL) ?? "claude-haiku-5-5";
  },
  get cronSecret() {
    return clean(process.env.CRON_SECRET);
  },
  get localAdminPassword() {
    return clean(process.env.LOCAL_ADMIN_PASSWORD);
  },
  get localSessionSecret() {
    return clean(process.env.LOCAL_SESSION_SECRET) ?? "local-dev-only-secret-change-me";
  },
  get allowDemoContent() {
    const v = clean(process.env.ALLOW_DEMO_CONTENT);
    if (v !== undefined) return v === "true";
    return appMode() === "local";
  },
  get isVercel() {
    return process.env.VERCEL === "1";
  },
};

export function appMode(): AppMode {
  return env.supabaseUrl && env.supabasePublishableKey ? "supabase" : "local";
}

export class ConfigError extends Error {}

export function assertDeployable(): void {
  if (appMode() === "local" && env.isVercel) {
    throw new ConfigError(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and DATABASE_URL (or connect the Supabase integration, which sets them).",
    );
  }
  if (appMode() === "supabase" && !env.databaseUrl) {
    throw new ConfigError("DATABASE_URL (or POSTGRES_URL from the Supabase integration) is required when Supabase is configured.");
  }
}

/** Which settings the running server can see — presence only, never values. */
export function configReport(): { name: string; present: boolean; note?: string }[] {
  const has = (k: string) => Boolean(process.env[k]?.trim());
  return [
    { name: "NEXT_PUBLIC_SUPABASE_URL", present: has("NEXT_PUBLIC_SUPABASE_URL") },
    { name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", present: has("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") || has("NEXT_PUBLIC_SUPABASE_ANON_KEY") },
    { name: "DATABASE_URL", present: has("DATABASE_URL"), note: has("DATABASE_URL") ? undefined : has("POSTGRES_URL") ? "using POSTGRES_URL instead" : undefined },
    { name: "CRON_SECRET", present: has("CRON_SECRET") },
    { name: "ANTHROPIC_API_KEY", present: has("ANTHROPIC_API_KEY"), note: `model: ${env.anthropicModel}` },
    { name: "ALLOW_DEMO_CONTENT", present: has("ALLOW_DEMO_CONTENT"), note: `demo questions ${env.allowDemoContent ? "allowed" : "not allowed"}` },
  ];
}

/** Which code version is running (Vercel system variables). */
export function deploymentInfo(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  const msg = process.env.VERCEL_GIT_COMMIT_MESSAGE?.split("\n")[0];
  const envName = process.env.VERCEL_ENV;
  return sha ? `${envName ?? "vercel"} · commit ${sha}${msg ? ` — ${msg}` : ""}` : "local";
}
