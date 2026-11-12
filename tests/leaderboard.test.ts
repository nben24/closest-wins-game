import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { dailyBoard, everyoneStats, weeklyBoard } from "@/lib/server/leaderboard";
import { beginRound, getPlayState, submitRound } from "@/lib/server/play";
import { getResults } from "@/lib/server/results";
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

async function answers(challengeId: string) {
  return (await db.query<{ answer: number }>("select answer from challenge_questions where challenge_id = $1 order by position", [challengeId])).map((r) => r.answer);
}

async function play(player: string, guesses: (string | null)[], finish = true) {
  const s = await getPlayState(player);
  const id = s.challenge!.id;
  const n = finish ? 5 : 2;
  for (let p = 1; p <= n; p++) {
    await beginRound(player, id, p);
    clock.advance(5000);
    await submitRound(player, id, p, guesses[p - 1], `g${p}`);
    clock.advance(500);
  }
  return id;
}

describe("public leaderboard", () => {
  it("ranks everyone who finished, shares ties, and excludes unfinished players", async () => {
    const [a, b, c, d] = [await makePlayer(db), await makePlayer(db), await makePlayer(db), await makePlayer(db)];
    const s = await getPlayState(a);
    const exact = (await answers(s.challenge!.id)).map(String);
    await play(a, exact);
    await play(b, exact);
    await play(c, [null, null, null, null, null]);
    await play(d, exact, false); // unfinished

    const board = await dailyBoard(c, "2026-11-11");
    expect(board.totalPlayers).toBe(3);
    const ranks = Object.fromEntries(board.top.map((r) => [r.playerId, r.rank]));
    expect(ranks[a]).toBe(1);
    expect(ranks[b]).toBe(1);
    expect(ranks[c]).toBe(3);
    expect(ranks[d]).toBeUndefined();
    expect(board.me?.playerId).toBe(c);
    expect(board.me?.isViewer).toBe(true);
    expect((await dailyBoard(d, "2026-11-11")).me).toBeNull();
  });

  it("sums each player's best five days in the week", async () => {
    const a = await makePlayer(db);
    for (const day of ["09", "10", "11", "12", "13", "14"]) {
      clock.set(`2026-11-${day}T18:00:00Z`);
      await play(a, ["1", "1", "1", "1", "1"]);
    }
    const w = await weeklyBoard(a, "2026-11-14");
    expect(w.weekStart).toBe("2026-11-09");
    expect(w.me?.daysPlayed).toBe(6);
    expect(w.me?.daysCounted).toBe(5);
    const totals = (await db.query<{ total_score: number }>("select total_score from attempts order by total_score desc")).map((r) => r.total_score);
    expect(w.me?.total).toBe(totals.slice(0, 5).reduce((x, y) => x + y, 0));
  });

  it("gives aggregate comparisons only with 3+ guesses and only after finishing", async () => {
    const [a, b, c] = [await makePlayer(db), await makePlayer(db), await makePlayer(db)];
    const s = await getPlayState(a);
    const id = s.challenge!.id;
    const ans = await answers(id);
    await play(b, ans.map((x) => String(x * 3)));
    await play(c, ans.map((x) => String(x * 5)));

    // a hasn't finished: no comparisons in results
    await beginRound(a, id, 1);
    clock.advance(5000);
    await submitRound(a, id, 1, String(ans[0]), "x");
    expect((await getResults(a, "2026-11-11")).everyone).toBeNull();
    clock.advance(500);
    for (let p = 2; p <= 5; p++) {
      await beginRound(a, id, p);
      clock.advance(5000);
      await submitRound(a, id, p, String(ans[p - 1]), `x${p}`);
      clock.advance(500);
    }
    const stats = await everyoneStats(a, id);
    expect(stats.players).toBe(3);
    expect(stats.rank).toBe(1);
    const q1 = stats.questions.find((q) => q.position === 1)!;
    expect(q1.submitted).toBe(3);
    expect(q1.beatPct).toBe(100);
    expect(q1.higherPct).toBe(67);
    expect((await getResults(a, "2026-11-11")).everyone?.rank).toBe(1);
  });
});
