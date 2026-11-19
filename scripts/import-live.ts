/**
 * LOCAL TESTING ONLY. Load a read-only snapshot of live game data (exported
 * from Supabase with the query in the instructions) into a SEPARATE local
 * database at .data/pglite-live, so the test branch can be previewed with
 * real players and guesses. Never touches Supabase or your normal local data.
 *
 *   npm run live:import -- ~/Downloads/snapshot.csv
 *   npm run dev:live            # then open http://localhost:3000/dev/guesses
 *
 * Re-running replaces the previous snapshot.
 */
import fs from "node:fs";
import crypto from "node:crypto";

process.env.LOCAL_SEED_DEMO = "false";
const DIR = ".data/pglite-live";

function readSnapshot(file: string): Record<string, Record<string, unknown>[] | null> {
  const raw = fs.readFileSync(file, "utf8");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("That file doesn't contain the snapshot. Re-run the export query and download the result.");
  let text = raw.slice(start, end + 1);
  // A CSV download wraps the cell in quotes and doubles every quote inside it.
  if (/^\{""/.test(text)) text = text.replace(/""/g, '"');
  return JSON.parse(text);
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: npm run live:import -- <path to the downloaded file>");
  const snap = readSnapshot(file.replace(/^~(?=\/)/, process.env.HOME ?? "~"));

  fs.rmSync(DIR, { recursive: true, force: true });
  const { createPgliteDb } = await import("@/lib/db");
  const db = await createPgliteDb(DIR);

  // Live auth ids are never exported; give each player a fresh local one.
  const players = (snap.players ?? []).map((p) => ({ ...p, auth_user_id: crypto.randomUUID() }));
  const order: [string, Record<string, unknown>[]][] = [
    ["daily_challenges", snap.daily_challenges ?? []],
    ["questions", snap.questions ?? []],
    ["challenge_questions", snap.challenge_questions ?? []],
    ["players", players],
    ["attempts", snap.attempts ?? []],
    ["rounds", snap.rounds ?? []],
  ];
  await db.tx(async (sql) => {
    // Skip the "published games are read-only" triggers while copying rows in as-is.
    await sql.query("set local session_replication_role = replica");
    for (const [table, rows] of order) {
      if (!rows.length) continue;
      await sql.query(`insert into ${table} select * from jsonb_populate_recordset(null::${table}, $1::jsonb)`, [JSON.stringify(rows)]);
      console.log(`  ${table}: ${rows.length}`);
    }
  });
  const days = await db.query<{ d: string }>("select to_char(max(challenge_date), 'YYYY-MM-DD') as d from daily_challenges");
  console.log(`Loaded into ${DIR} (latest day ${days[0]?.d}). Now run: npm run dev:live`);
  await db.close();
}

main().catch((e) => {
  console.error("Import failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
