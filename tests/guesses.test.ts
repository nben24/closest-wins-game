import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { closestGuesses, missNote, wildestGuess, type PlayerGuess } from "@/lib/guess-summary";
import { dayGuesses } from "@/lib/server/guesses";
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

async function play(player: string, guesses: (string | null)[], finish = true) {
  const s = await getPlayState(player);
  const id = s.challenge!.id;
  for (let p = 1; p <= (finish ? 5 : 2); p++) {
    await beginRound(player, id, p);
    clock.advance(5000);
    await submitRound(player, id, p, guesses[p - 1], `g${p}`);
    clock.advance(500);
  }
  return id;
}

describe("everyone's guesses", () => {
  it("stays locked (no answers, no guesses) until the viewer finishes", async () => {
    const [a, b, c] = [await makePlayer(db), await makePlayer(db), await makePlayer(db)];
    await play(a, ["1", "2", "3", "4", "5"]);
    await play(b, ["9", "9", "9", "9", "9"], false); // mid-game

    const early = await dayGuesses(b, "2026-11-11");
    expect(early.locked).toBe(true);
    expect(early.players).toBe(1);
    expect(early.questions).toEqual([]);
    expect(early.standings).toEqual([]);
    expect(JSON.stringify(early)).not.toContain("answer");
    expect((await dayGuesses(c, "2026-11-11")).locked).toBe(true); // never started

    await play(c, ["5", null, "7", "8", "9"]);
    const open = await dayGuesses(c, "2026-11-11");
    expect(open.locked).toBe(false);
    expect(open.players).toBe(2);
    expect(open.questions).toHaveLength(5);
    // only finished players appear; the mid-game player does not
    for (const q of open.questions) {
      expect(q.guesses.map((g) => g.playerId).sort()).toEqual([a, c].sort());
    }
    const q2 = open.questions.find((q) => q.position === 2)!;
    expect(q2.guesses.find((g) => g.playerId === c)!.guess).toBeNull(); // blank answer
    expect(q2.guesses[q2.guesses.length - 1].playerId).toBe(c); // no-answers sort last
    expect(open.standings.find((s) => s.isViewer)!.playerId).toBe(c);
    expect(open.standings.map((s) => s.total)).toEqual([...open.standings.map((s) => s.total)].sort((x, y) => y - x));
  });

  it("is locked for a day with no published game", async () => {
    const a = await makePlayer(db);
    const r = await dayGuesses(a, "2026-10-01");
    expect(r).toMatchObject({ locked: true, number: null, questions: [] });
  });
});

const g = (id: string, guess: number | null): PlayerGuess => ({ playerId: id, name: id, avatarId: "otter", guess, score: 0, isViewer: false });

describe("closest / wildest / miss notes", () => {
  it("finds ties for closest and the single wildest guess", () => {
    const list = [g("a", 2722), g("b", 2500), g("c", 2), g("d", 828000), g("e", 2722), g("f", null)];
    expect(closestGuesses("ratio", 2722, list).map((x) => x.playerId)).toEqual(["a", "e"]);
    // 2 is 1,361× too low; 828,000 is 304× too high
    expect(wildestGuess("ratio", 2722, list)!.playerId).toBe("c");
    expect(wildestGuess("year", 1989, [g("a", 1989), g("b", 1915), g("c", 1990)])!.playerId).toBe("b");
  });

  it("has no wildest with fewer than 3 answers or when everyone agrees", () => {
    expect(wildestGuess("ratio", 10, [g("a", 1), g("b", 100), g("c", null)])).toBeNull();
    expect(wildestGuess("ratio", 10, [g("a", 5), g("b", 5), g("c", 5)])).toBeNull();
  });

  it("treats a zero guess on a ratio question as the furthest off", () => {
    expect(wildestGuess("ratio", 480, [g("a", 0), g("b", 37), g("c", 500)])!.playerId).toBe("a");
  });

  it("describes misses in plain words", () => {
    expect(missNote("ratio", 480, 37)).toBe("13× too low");
    expect(missNote("ratio", 2722, 828000)).toBe("304× too high");
    expect(missNote("ratio", 480, 600)).toBe("25% too high");
    expect(missNote("year", 1989, 1915)).toBe("74 years early");
    expect(missNote("year", 1989, 1990)).toBe("1 year late");
    expect(missNote("percent", 40, 46)).toBe("6 points high");
    expect(missNote("absolute", 10, 7.5)).toBe("2.5 too low");
    expect(missNote("ratio", 44, 44)).toBe("exact");
  });
});
