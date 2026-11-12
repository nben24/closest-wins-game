/**
 * Vercel build step (see vercel.json "buildCommand").
 * Production deployments apply pending database migrations before building,
 * so connecting the Supabase integration is enough to create the tables.
 * Preview deployments skip this so a branch can't change the live database.
 */
import { execSync } from "node:child_process";
import { getDb, runMigrations } from "@/lib/db";
import { appMode } from "@/lib/env";

async function main() {
  if (process.env.VERCEL_ENV === "production" && appMode() === "supabase") {
    const db = await getDb();
    const ran = await runMigrations(db, (m) => console.log(`[migrate] ${m}`));
    console.log(ran.length ? `[migrate] Applied ${ran.length} migration(s).` : "[migrate] Database is up to date.");
    await db.close();
  } else {
    console.log(`[migrate] Skipped (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}, mode=${appMode()}).`);
  }
  execSync("next build", { stdio: "inherit" });
}

main().catch((e) => {
  console.error("[vercel-build] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
