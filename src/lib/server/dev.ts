import "server-only";
import { appMode, env } from "@/lib/env";

/**
 * Developer-only testing tools (fake players, live-data preview). Allowed only
 * in local mode on a developer's machine: never with Supabase configured,
 * never on Vercel, never in a production build.
 */
export function devToolsAllowed(): boolean {
  return appMode() === "local" && !env.isVercel && process.env.NODE_ENV !== "production";
}
