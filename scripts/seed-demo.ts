/**
 * Load the clearly-labeled DEMO questions (unverified, provenance = 'demo').
 * Local mode does this automatically. In production they are ignored by the
 * scheduler unless ALLOW_DEMO_CONTENT=true — so this is only useful for a
 * staging/demo deployment.
 *   npm run db:seed-demo
 */
import { describeDatabaseTarget, getDb } from "@/lib/db";
import { seedDemoQuestions } from "@/lib/db/seed";

async function main() {
  console.log(`Database: ${describeDatabaseTarget()}`);
  const db = await getDb();
  const n = await seedDemoQuestions(db);
  console.log(`Inserted ${n} demo question(s). They are marked as demo / unverified.`);
  await db.close();
}

main().catch((e) => {
  console.error("Seeding failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
