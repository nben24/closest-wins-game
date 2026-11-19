import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { appMode, env } from "@/lib/env";
import { AVATARS } from "@/lib/names";
import { scoreGuess, type ScoringType } from "@/lib/scoring";
import { getPlayableChallenge, today } from "@/lib/server/challenges";
import { now } from "@/lib/server/clock";
import { route } from "@/lib/server/errors";

/**
 * LOCAL TESTING ONLY. Fills today's local game with ~20 fake players who
 * finished it, so the "everyone's guesses" view has something to show.
 *
 * Refuses to run anywhere except local mode on a developer's machine: never
 * with Supabase configured, never on Vercel, never in a production build.
 * Open http://localhost:3000/api/dev/seed-guesses once after `npm run dev`.
 * Running it again does nothing (the fake players already finished).
 */

const FAKE: [string, string, "sharp" | "ok" | "wild"][] = [
  ["Fearless", "Glacier", "sharp"], ["Speedy", "Volcano", "sharp"], ["Chipper", "Pelican", "ok"], ["Witty", "Narwhal", "ok"],
  ["Sunlit", "Dolphin", "ok"], ["Jolly", "Mango", "wild"], ["Wise", "Waffle", "wild"], ["Mindful", "Raccoon", "ok"],
  ["Polite", "Rocket", "ok"], ["Keen", "Penguin", "wild"], ["Cozy", "Biscuit", "ok"], ["Noble", "Badger", "wild"],
  ["Breezy", "Falcon", "sharp"], ["Golden", "Toucan", "ok"], ["Quirky", "Lemur", "wild"], ["Steady", "Beaver", "sharp"],
  ["Zesty", "Pretzel", "ok"], ["Groovy", "Walrus", "ok"], ["Daring", "Comet", "wild"], ["Peppy", "Teapot", "ok"],
];

/** Deterministic per-player-per-question random numbers, so reruns look the same. */
function rng(seed: string): () => number {
  let h = crypto.createHash("sha256").update(seed).digest().readUInt32LE(0) || 1;
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 1_000_000) / 1_000_000;
  };
}
function normal(r: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(r(), 1e-6))) * Math.cos(2 * Math.PI * r());
}
function roundNice(v: number, decimals: boolean): number {
  if (decimals && Math.abs(v) < 20) return Math.round(v * 100) / 100;
  if (Math.abs(v) < 100) return Math.round(v);
  const mag = 10 ** Math.max(0, Math.floor(Math.log10(Math.abs(v))) - 1);
  return Math.round(v / mag) * mag;
}

function fakeGuess(
  skill: "sharp" | "ok" | "wild",
  q: { answer: number; scoring_type: ScoringType; allow_decimal: boolean; allow_negative: boolean; tolerance: number },
  r: () => number,
): number | null {
  const roll = r();
  if (roll < 0.04) return null; // ran out of time
  const sigma = { sharp: 0.25, ok: 0.7, wild: 1.6 }[skill];
  if (roll > 0.995 - (skill === "wild" ? 0.06 : 0.02)) {
    // a typo: an extra zero or a missing one
    const typo = q.answer * (r() < 0.5 ? 10 : 0.1);
    return q.scoring_type === "year" ? Math.round(q.answer + (r() < 0.5 ? -60 : 30)) : roundNice(typo, q.allow_decimal);
  }
  if (roll > 0.88 && skill !== "wild") return q.answer; // nailed it
  if (q.scoring_type === "year") return Math.round(q.answer + normal(r) * sigma * 8);
  if (q.scoring_type === "percent") return Math.min(100, Math.max(0, Math.round(q.answer + normal(r) * sigma * 12)));
  if (q.scoring_type === "absolute") {
    const v = roundNice(q.answer + normal(r) * sigma * q.tolerance * 1.5, q.allow_decimal);
    return q.allow_negative ? v : Math.max(0, v);
  }
  return roundNice(q.answer * Math.exp(normal(r) * sigma), q.allow_decimal);
}

export const GET = route(async () => {
  if (appMode() !== "local" || env.isVercel || process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const date = today();
  const ch = await getPlayableChallenge(date);
  if (!ch) return NextResponse.json({ error: "No local game for today." }, { status: 409 });
  const db = await getDb();
  const qs = await db.query<{ position: number; answer: number; scoring_type: ScoringType; tolerance: number; allow_decimal: boolean; allow_negative: boolean }>(
    "select position, answer, scoring_type, tolerance, allow_decimal, allow_negative from challenge_questions where challenge_id = $1 order by position",
    [ch.id],
  );
  const at = now();
  let added = 0;
  await db.tx(async (sql) => {
    for (const [i, [adj, noun, skill]] of FAKE.entries()) {
      const authId = `00000000-0000-4000-9000-${String(i + 1).padStart(12, "0")}`;
      let p = await sql.one<{ id: string }>("select id from players where auth_user_id = $1", [authId]);
      if (!p) {
        p = await sql.one<{ id: string }>(
          `insert into players (auth_user_id, avatar_id, name_adjective, name_noun)
           values ($1, $2, $3, $4)
           on conflict do nothing returning id`,
          [authId, AVATARS[i % AVATARS.length].id, adj, noun],
        );
        if (!p) continue; // nickname already taken locally
      }
      const done = await sql.one("select 1 from attempts where player_id = $1 and challenge_id = $2", [p.id, ch.id]);
      if (done) continue;

      const start = new Date(at.getTime() - (FAKE.length - i) * 7 * 60_000 - 5 * 60_000);
      let total = 0;
      const rounds = qs.map((q) => {
        const g = fakeGuess(skill, q, rng(`${date}:${i}:${q.position}`));
        const score = g === null ? 0 : scoreGuess({ type: q.scoring_type, tolerance: Number(q.tolerance) }, Number(q.answer), g);
        total += score;
        return { q, g, score };
      });
      const a = await sql.one<{ id: string }>(
        `insert into attempts (player_id, challenge_id, status, total_score, rounds_finished, started_at, completed_at)
         values ($1, $2, 'completed', $3, $4, $5, $6) returning id`,
        [p.id, ch.id, total, qs.length, start, new Date(start.getTime() + 4 * 60_000)],
      );
      for (const { q, g, score } of rounds) {
        const read = new Date(start.getTime() + (q.position - 1) * 40_000);
        const opens = new Date(read.getTime() + 4_000);
        const deadline = new Date(opens.getTime() + 25_000);
        const submitted = new Date(opens.getTime() + 9_000);
        await sql.query(
          `insert into rounds (attempt_id, position, reading_started_at, answer_opens_at, deadline_at, status, raw_input, guess, score, submitted_at, finalized_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [a!.id, q.position, read, opens, deadline, g === null ? "timed_out" : "answered", g === null ? null : String(g), g, score, g === null ? null : submitted, g === null ? deadline : submitted],
        );
      }
      added++;
    }
  });
  return NextResponse.json({ ok: true, date, fakePlayersAdded: added, note: "Now finish today's game yourself and open the Leaderboard." });
});
