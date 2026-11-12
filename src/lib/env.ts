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
    return clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabasePublishableKey() {
    return clean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ?? clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  },
  get databaseUrl() {
    return clean(process.env.DATABASE_URL);
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
  get appUrl() {
    return clean(process.env.NEXT_PUBLIC_APP_URL);
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
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and DATABASE_URL.",
    );
  }
  if (appMode() === "supabase" && !env.databaseUrl) {
    throw new ConfigError("DATABASE_URL is required when Supabase is configured.");
  }
}
