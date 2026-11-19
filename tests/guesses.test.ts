import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { closestGuesses, isReallyOff, missNote, wildestGuess, wildestGuesses, type PlayerGuess } from "@/lib/guess-summary";
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
    expect(JSON.stringify(early)).not.toContain("answer");
    expect((await dayGuesses(c, "2026-11-11")).locked).toBe(true); // never started

    await play(c, ["5", null, "7", "8", "9"]);
    const open = await dayGuesses(c, "2026-11-11");
    expect(open.locked).toBe(false);
    expect(open.players).toBe(2);
    expect(open.questions).toHaveLength(5);
    // only finished players count; the mid-game player does not
    for (const q of open.questions) expect(q.finished).toBe(2);
    const q2 = open.questions.find((q) => q.position === 2)!;
    expect(q2.dots).toHaveLength(1); // c left it blank
    expect(q2.noAnswer).toBe(1);
    expect(q2.mine).toEqual({ guess: null, score: 0 });
    const q1 = open.questions.find((q) => q.position === 1)!;
    expect(q1.dots.map((d) => d.guess)).toEqual([1, 5]); // sorted by value
    expect(q1.dots.find((d) => d.isViewer)!.guess).toBe(5);
    // dots carry no identity, and no player ids are sent at all
    for (const d of q1.dots) expect(Object.keys(d).sort()).toEqual(["guess", "isViewer", "score"]);
    const json = JSON.stringify(open);
    for (const id of [a, b, c]) expect(json).not.toContain(id);
  });

  it("names only the closest and a really-off wildest guess", async () => {
    const ps = [await makePlayer(db), await makePlayer(db), await makePlayer(db), await makePlayer(db)];
    // Answers come from the seeded demo game; read them via a finished player's view.
    await play(ps[0], ["1", "1", "1", "1", "1"]);
    const peek = await dayGuesses(ps[0], "2026-11-11");
    const ans = peek.questions.map((q) => q.answer);
    await play(ps[1], ans.map(String)); // exact on everything
    await play(ps[2], ans.map((x) => String(x + 1)));
    await play(ps[3], ans.map((x) => String(x * 1000 + 1e6))); // way off
    const v = await dayGuesses(ps[2], "2026-11-11");
    for (const q of v.questions) {
      expect(q.closestCount).toBe(1);
      expect(q.closest[0].guess).toBe(q.answer);
      expect(Object.keys(q.closest[0])).not.toContain("playerId");
      expect(q.wildest).not.toBeNull();
      expect(q.mine!.guess).toBe(q.answer + 1);
    }
  });

  it("doesn't call out a wildest guess when nobody was far off", async () => {
    const ps = [await makePlayer(db), await makePlayer(db), await makePlayer(db), await makePlayer(db)];
    await getPlayState(ps[0]); // makes sure today's game exists
    const qs = await db.query<{ answer: number; tolerance: number; scoring_type: string }>(
      `select q.answer, q.tolerance, q.scoring_type from challenge_questions q
         join daily_challenges d on d.id = q.challenge_id
        where d.challenge_date = '2026-11-11' order by q.position`,
    );
    const exact = qs.map((q) => String(Number(q.answer)));
    const slightly = qs.map((q) => String(q.scoring_type === "ratio" ? Math.round(Number(q.answer) * 1.1) : Number(q.answer) + Math.max(1, Math.round(Number(q.tolerance) * 0.5))));
    await play(ps[0], exact);
    await play(ps[1], exact);
    await play(ps[2], exact);
    await play(ps[3], slightly);
    const v = await dayGuesses(ps[3], "2026-11-11");
    for (const q of v.questions) {
      expect(q.closestCount).toBe(3);
      expect(q.wildest).toBeNull(); // furthest guess was still a good one
      expect(q.mine!.score).toBeGreaterThanOrEqual(200);
    }
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

  it("reports ties for wildest", () => {
    // year question: 1915 and 2063 are both 74 years off
    expect(wildestGuesses("year", 1989, [g("a", 1915), g("b", 1990), g("c", 2063)]).map((x) => x.playerId)).toEqual(["a", "c"]);
    // count question: 1,000 and 4,000 are both 2× off an answer of 2,000
    expect(wildestGuesses("ratio", 2000, [g("a", 1000), g("b", 2100), g("c", 4000)]).map((x) => x.playerId)).toEqual(["a", "c"]);
  });

  it("only treats guesses that earned almost nothing as wild", () => {
    // strict count question (half points at 30% off): 58% off isn't wild, 2.5× off is
    expect(isReallyOff({ type: "ratio", tolerance: 1.3 }, 100, 158)).toBe(false);
    expect(isReallyOff({ type: "ratio", tolerance: 1.3 }, 100, 250)).toBe(true);
    // live examples from 2026-11-14 that the old 3× floor wrongly skipped
    expect(isReallyOff({ type: "ratio", tolerance: 1.25 }, 88, 175)).toBe(true);
    // loose count question (half points at 2× off): 3× off still earned decent points
    expect(isReallyOff({ type: "ratio", tolerance: 2 }, 100, 300)).toBe(false);
    expect(isReallyOff({ type: "ratio", tolerance: 2 }, 100, 1000)).toBe(true);
    // year question with half points at 10 years: 20 years off isn't wild, 40 is
    expect(isReallyOff({ type: "year", tolerance: 10 }, 1989, 1969)).toBe(false);
    expect(isReallyOff({ type: "year", tolerance: 10 }, 1989, 1949)).toBe(true);
    // a 0 on a count question is always wild
    expect(isReallyOff({ type: "ratio", tolerance: 2 }, 100, 0)).toBe(true);
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
