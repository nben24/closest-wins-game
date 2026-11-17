import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { fairTolerance, isPlausibleYear, scoreGuess } from "@/lib/scoring";
import { questionFlags, type AnswerQuestion, type AnswerRound } from "@/lib/server/admin/answers";
import { crossCheckAgrees, relaxedBlockers } from "@/lib/server/ai/pipeline";
import type { Proposal, Research } from "@/lib/server/ai/schemas";
import { beginRound, getPlayState, submitRound } from "@/lib/server/play";
import { ensurePrizeCodes, myLastWeekPrize, newPrizeCode } from "@/lib/server/prizes";
import { fakeClock, freshDb, makePlayer, resetClock } from "./support/db";

describe("fairer tolerances", () => {
  it("loosens tight ratio tolerances by difficulty and never tightens", () => {
    expect(fairTolerance("ratio", 1.15, 29032, "easy")).toBe(1.35);
    expect(fairTolerance("ratio", 1.15, 29032, "medium")).toBe(1.5);
    expect(fairTolerance("ratio", 1.3, 100, "hard")).toBe(1.8);
    expect(fairTolerance("ratio", 2.5, 100, "medium")).toBe(2.5);
  });
  it("scales year tolerance with how long ago it was", () => {
    expect(fairTolerance("year", 3, 2007, "easy", 2026)).toBe(3);
    expect(fairTolerance("year", 8, 1886, "medium", 2026)).toBe(18);
    expect(fairTolerance("year", 5, 1200, "hard", 2026)).toBe(25);
  });
  it("turns last week's harsh zeros into real points", () => {
    // Everest: 23,000 ft used to score 225 at ×1.15
    expect(scoreGuess({ type: "ratio", tolerance: 1.15 }, 29032, 23000)).toBe(225);
    expect(scoreGuess({ type: "ratio", tolerance: fairTolerance("ratio", 1.15, 29032, "medium") }, 29032, 23000)).toBeGreaterThan(700);
    // Coca-Cola 1902 (16 years off an 1886 answer) used to score 141 at ±8
    expect(scoreGuess({ type: "year", tolerance: fairTolerance("year", 8, 1886, "medium", 2026) }, 1886, 1902)).toBeGreaterThan(500);
  });
  it("recognizes year typos", () => {
    expect(isPlausibleYear(0)).toBe(false);
    expect(isPlausibleYear(12)).toBe(false);
    expect(isPlausibleYear(1886)).toBe(true);
  });
});

describe("relaxed approval rules", () => {
  const p = { answer: 42, scoring_type: "ratio", tolerance: 1.3, difficulty: "medium" } as Proposal;
  const r = { verdict: "supported", conflicting_sources: false, is_ambiguous: false, family_friendly: true, value_in_source: 42,
    source_url: "https://example.org/dogs", source_title: "Dog teeth", excerpt: "Adult dogs have 42 teeth." } as Research;
  it("needs supporting research", () => {
    expect(relaxedBlockers(p, r)).toEqual([]);
    expect(relaxedBlockers(p, { ...r, verdict: "not_found" })).not.toEqual([]);
    expect(relaxedBlockers(p, { ...r, value_in_source: 50 })).not.toEqual([]);
  });
  it("accepts a double-check only when it lands on (nearly) the same fact", () => {
    expect(crossCheckAgrees(p, 42)).toBe(true);
    expect(crossCheckAgrees(p, 45)).toBe(true);
    expect(crossCheckAgrees(p, 50)).toBe(false);
    expect(crossCheckAgrees(p, 120)).toBe(false);
    // Steelers: 177 proposed vs ~223 is "close enough to score" for a player, but not the same fact.
    expect(crossCheckAgrees({ ...p, answer: 177, question_type: "team_stats" } as Proposal, 215)).toBe(false);
    expect(crossCheckAgrees({ ...p, answer: 1955, scoring_type: "year" } as Proposal, 1956)).toBe(true);
    expect(crossCheckAgrees({ ...p, answer: 1955, scoring_type: "year" } as Proposal, 1958)).toBe(false);
    expect(crossCheckAgrees(p, null)).toBe(false);
  });
});

describe("question flags", () => {
  const q: AnswerQuestion = { position: 1, prompt: "", answer: 100, unit: "", category: "everyday", scoringType: "ratio", tolerance: 1.3, difficulty: "medium", voided: false };
  const r = (guess: number, score: number): AnswerRound => ({ position: 1, status: "answered", guess, score, secondsToAnswer: 3 });
  it("flags too easy, too strict and everyone-was-lost", () => {
    expect(questionFlags(q, [r(100, 1000), r(100, 1000), r(100, 1000), r(90, 800), r(50, 50)]).map((f) => f.key)).toEqual(["too_easy"]);
    expect(questionFlags(q, [r(140, 60), r(150, 50), r(70, 60), r(130, 90), r(160, 40)]).map((f) => f.key)).toEqual(["too_strict"]);
    expect(questionFlags(q, [r(5, 0), r(9000, 0), r(2, 0), r(100000, 0), r(400, 10)]).map((f) => f.key)).toEqual(["lost"]);
    expect(questionFlags(q, [r(5, 0), r(9000, 0)])).toEqual([]);
  });
});

describe("prize codes", () => {
  let db: Db;
  let clock: ReturnType<typeof fakeClock>;
  beforeEach(async () => {
    clock = fakeClock("2026-11-17T18:00:00Z");
    db = await freshDb();
  });
  afterEach(async () => {
    resetClock();
    await db.close();
  });

  async function playDay(player: string, guess: string) {
    const id = (await getPlayState(player)).challenge!.id;
    for (let p = 1; p <= 5; p++) {
      await beginRound(player, id, p);
      clock.advance(5000);
      await submitRound(player, id, p, guess, `${player}${p}${clock.now.toISOString()}`);
      clock.advance(500);
    }
  }

  it("makes readable codes", () => {
    expect(newPrizeCode()).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it("gives last week's top 3 their own private code, and nobody else", async () => {
    const players = [await makePlayer(db), await makePlayer(db), await makePlayer(db), await makePlayer(db)];
    clock.set("2026-11-18T18:00:00Z"); // week of Nov 16
    const answers = async () => {
      const id = (await getPlayState(players[0])).challenge!.id;
      return (await db.query<{ answer: number }>("select answer from challenge_questions where challenge_id = $1 order by position", [id])).map((r) => r.answer);
    };
    const ans = await answers();
    for (let i = 0; i < players.length; i++) {
      const id = (await getPlayState(players[i])).challenge!.id;
      for (let p = 1; p <= 5; p++) {
        await beginRound(players[i], id, p);
        clock.advance(5000);
        await submitRound(players[i], id, p, String(Math.round(ans[p - 1] * (1 + i * 0.3))), `s${i}${p}`);
        clock.advance(500);
      }
    }

    // During the week: no codes yet.
    expect(await ensurePrizeCodes("2026-11-16")).toEqual([]);
    expect(await myLastWeekPrize(players[0])).toBeNull();

    clock.set("2026-11-24T15:00:00Z"); // the following Tuesday
    const first = await myLastWeekPrize(players[0]);
    expect(first).toMatchObject({ weekStart: "2026-11-16", rank: 1 });
    expect((await myLastWeekPrize(players[2]))?.rank).toBe(3);
    expect(await myLastWeekPrize(players[3])).toBeNull(); // 4th place: no code
    // Stable once created, and each code is different.
    expect((await myLastWeekPrize(players[0]))!.code).toBe(first!.code);
    const all = await ensurePrizeCodes("2026-11-16");
    expect(new Set(all.map((c) => c.code)).size).toBe(3);
  });

  it("gives no codes for weeks before prizes started", async () => {
    const a = await makePlayer(db);
    clock.set("2026-11-11T18:00:00Z");
    await playDay(a, "1");
    clock.set("2026-11-17T18:00:00Z");
    expect(await ensurePrizeCodes("2026-11-09")).toEqual([]);
  });
});
