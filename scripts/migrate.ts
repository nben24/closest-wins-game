/**
 * Apply SQL migrations in supabase/migrations to DATABASE_URL (or the local
 * embedded database when DATABASE_URL is unset).
 *   npm run db:migrate
 */
import { describeDatabaseTarget, getDb, runMigrations } from "@/lib/db";

async function main() {
  console.log(`Database: ${describeDatabaseTarget()}`);
  const db = await getDb();
  const ran = await runMigrations(db, (m) => console.log(m));
  console.log(ran.length ? `Applied ${ran.length} migration(s).` : "Database is up to date.");
  await db.close();
}

main().catch((e) => {
  console.error("Migration failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
