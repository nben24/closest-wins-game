import { afterEach, beforeEach, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "@/lib/db";
import { dayAnswers } from "@/lib/server/admin/answers";
import { beginRound, getPlayState, submitRound } from "@/lib/server/play";
import { fakeClock, freshDb, makePlayer, resetClock } from "./support/db";

let db: Db;
let clock: ReturnType<typeof fakeClock>;
beforeEach(async () => {
  clock = fakeClock("2026-11-11T20:00:00Z");
  db = await freshDb();
});
afterEach(async () => {
  resetClock();
  await db.close();
});

it("lists every player's guesses, points and timing for the day", async () => {
  const [a, b] = [await makePlayer(db), await makePlayer(db)];
  const id = (await getPlayState(a)).challenge!.id;
  const answers = (await db.query<{ answer: number }>("select answer from challenge_questions where challenge_id = $1 order by position", [id])).map((r) => r.answer);
  for (let p = 1; p <= 5; p++) {
    await beginRound(a, id, p);
    clock.advance(6000); // 4s reading + 2s
    await submitRound(a, id, p, String(answers[p - 1]), `a${p}`);
    clock.advance(500);
  }
  await beginRound(b, id, 1);
  clock.advance(5000);
  await submitRound(b, id, 1, null, "b1");

  const d = await dayAnswers("2026-11-11");
  expect(d.questions).toHaveLength(5);
  expect(d.players.map((p) => p.playerId)).toEqual([a, b]); // finished first
  const pa = d.players[0];
  expect(pa.status).toBe("completed");
  expect(pa.rounds[1].guess).toBe(answers[0]);
  expect(pa.rounds[1].score).toBe(1000);
  expect(pa.rounds[1].secondsToAnswer).toBeCloseTo(2, 1);
  expect(d.players[1].status).toBe("in_progress");
  expect(d.players[1].rounds[1].status).toBe("no_answer");
  expect(d.players[1].rounds[2]).toBeUndefined();
  expect((await dayAnswers("2026-11-12")).challenge).toBeNull();
});

it("is only used by admin pages (it exposes answers and raw guesses)", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f) && readFileSync(p, "utf8").includes("server/admin/answers") && !p.includes(join("app", "admin"))) offenders.push(p);
    }
  };
  walk("src");
  expect(offenders).toEqual([]);
});
