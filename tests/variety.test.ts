import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { classifyQuestion, crowdedTypes, GENERATABLE_TYPES, perJobTypeCap, planTypes, type QuestionType } from "@/lib/question-types";
import { pickDailySet, type PoolQuestion } from "@/lib/scheduler";
import { rebuildUpcoming } from "@/lib/server/admin/ops";
import { eligiblePool, fillSchedule, today } from "@/lib/server/challenges";
import { addDays } from "@/lib/time";
import { fakeClock, freshDb, resetClock } from "./support/db";

describe("question types", () => {
  it.each([
    ["In what year did the first iPhone go on sale in the US?", "year", "year"],
    ["How many years passed between the Wright brothers' first powered flight and the first Moon landing?", "ratio", "years_between"],
    ["What was the US launch price of the original PlayStation console in 1995, in dollars?", "ratio", "price"],
    ["In 1970, what was the US national average retail price of one gallon of regular gasoline, in dollars?", "ratio", "then_vs_now"],
    ["How many calories are in one medium banana?", "ratio", "calories"],
    ["How many minutes long is the 1972 film The Godfather?", "ratio", "runtime"],
    ["How many Academy Awards did the movie Forrest Gump win?", "absolute", "awards"],
    ["Over the 1996 through 2024 MLB seasons, how many regular-season games did the Yankees win in total?", "ratio", "team_stats"],
    ["How many miles long is the historic Route 66 from Chicago to Santa Monica?", "ratio", "distance"],
    ["How many pounds does an adult domestic house cat weigh, roughly?", "ratio", "weight"],
    ["How many teaspoons are in one US tablespoon?", "absolute", "measure"],
    ["How many days did it take to build the Empire State Building, from groundbreaking to opening?", "ratio", "duration"],
    ["How many times in one full day do a clock's hour and minute hands exactly overlap?", "ratio", "everyday_math"],
    ["How many US pennies would you need to stack to reach one foot high?", "ratio", "scale"],
    ["What percentage of a raw watermelon's weight is water?", "percent", "percent"],
    ["How many ridges (reeds) are on the outer edge of a US quarter?", "ratio", "count"],
  ])("%s → %s/%s", (prompt, scoringType, expected) => {
    expect(classifyQuestion({ prompt, scoringType })).toBe(expected);
  });

  it("classifies sports rules separately from distances", () => {
    expect(classifyQuestion({ prompt: "How many holes are played in one standard round of golf?", category: "sports" })).toBe("rules");
    expect(classifyQuestion({ prompt: "How long is a tennis court baseline to baseline, in feet?", category: "sports" })).toBe("rules");
  });

  it("plans different, under-represented types and respects the per-job cap", () => {
    const bank: Partial<Record<QuestionType, number>> = { year: 30, distance: 25, count: 25, price: 10 };
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const plan = planTypes(5, bank, {}, 2, rand);
    expect(new Set(plan).size).toBe(5);
    for (const t of ["year", "distance", "count", "price"]) expect(plan).not.toContain(t);
    // A type already at the cap for this job is never planned again.
    const full = Object.fromEntries(GENERATABLE_TYPES.filter((t) => t !== "scale").map((t) => [t, 2])) as Partial<Record<QuestionType, number>>;
    expect(planTypes(3, {}, full, 2, rand)).toEqual(["scale"]);
    expect(perJobTypeCap(20)).toBe(3);
    expect(crowdedTypes(bank, 2)).toEqual(["year", "distance"]);
  });
});

const CATS = ["everyday", "food", "animals", "entertainment", "geography", "products", "sports", "science"];
function pool(): PoolQuestion[] {
  const types = GENERATABLE_TYPES;
  const out: PoolQuestion[] = [];
  let n = 0;
  for (const t of types) {
    for (const d of ["easy", "easy", "medium", "medium", "hard"] as const) {
      n++;
      out.push({ id: `q${String(n).padStart(3, "0")}`, prompt: `w${n}a w${n}b w${n}c w${n}d?`, category: CATS[n % CATS.length], difficulty: d, subjectKey: `subject ${n}`, type: t });
    }
  }
  return out;
}

describe("daily set variety", () => {
  it("picks five different types and categories with one hard question", () => {
    const set = pickDailySet(pool(), { seed: "2026-12-01" })!;
    expect(set).toHaveLength(5);
    expect(new Set(set.map((q) => q.type)).size).toBe(5);
    expect(new Set(set.map((q) => q.category)).size).toBe(5);
    expect(set.filter((q) => q.difficulty === "hard")).toHaveLength(1);
    expect(set.filter((q) => q.category === "sports").length).toBeLessThanOrEqual(1);
  });

  it("avoids types the neighbouring days already use", () => {
    const p = pool();
    const yesterday = pickDailySet(p, { seed: "2026-12-01" })!;
    const recent = yesterday.map((q) => ({ prompt: q.prompt, subjectKey: q.subjectKey, date: "2026-12-01", type: q.type, category: q.category }));
    const rest = p.filter((q) => !yesterday.includes(q));
    const next = pickDailySet(rest, { seed: "2026-12-02", date: "2026-12-02", recent })!;
    const used = new Set(yesterday.map((q) => q.type));
    expect(next.some((q) => used.has(q.type))).toBe(false);
  });

  it("never runs a category three days in a row when it can avoid it", () => {
    const p = pool();
    const sport = p.filter((q) => q.category === "sports");
    const recent = [
      { prompt: sport[0].prompt, subjectKey: sport[0].subjectKey, date: "2026-12-01", type: sport[0].type, category: "sports" },
      { prompt: sport[1].prompt, subjectKey: sport[1].subjectKey, date: "2026-12-02", type: sport[1].type, category: "sports" },
    ];
    const rest = p.filter((q) => q !== sport[0] && q !== sport[1]);
    const set = pickDailySet(rest, { seed: "2026-12-03", date: "2026-12-03", recent })!;
    expect(set.some((q) => q.category === "sports")).toBe(false);
  });

  it("still fills a day when the bank has little variety", () => {
    const same = pool().map((q) => ({ ...q, type: "year" as QuestionType, category: "entertainment" }));
    expect(pickDailySet(same, { seed: "2026-12-03" })).toHaveLength(5);
  });
});

describe("rebuild upcoming days", () => {
  let db: Db;
  beforeEach(async () => {
    fakeClock("2026-11-16T20:00:00Z");
    db = await freshDb();
  });
  afterEach(async () => {
    resetClock();
    await db.close();
  });

  it("re-picks every scheduled future day and leaves today alone", async () => {
    const t = today();
    await fillSchedule(t, 4, "admin");
    const todayBefore = await db.query<{ question_id: string }>(
      "select cq.question_id from challenge_questions cq join daily_challenges dc on dc.id = cq.challenge_id where dc.challenge_date = $1 order by position",
      [t],
    );
    const r = await rebuildUpcoming("admin");
    expect(r.dates).toEqual([addDays(t, 1), addDays(t, 2), addDays(t, 3)]);
    const todayAfter = await db.query<{ question_id: string }>(
      "select cq.question_id from challenge_questions cq join daily_challenges dc on dc.id = cq.challenge_id where dc.challenge_date = $1 order by position",
      [t],
    );
    expect(todayAfter).toEqual(todayBefore);
    const counts = await db.query<{ n: number }>(
      "select count(*)::int as n from challenge_questions cq join daily_challenges dc on dc.id = cq.challenge_id where dc.challenge_date > $1 group by dc.id",
      [t],
    );
    expect(counts.map((c) => c.n)).toEqual([5, 5, 5]);
  });

  it("changes nothing when there aren't enough questions", async () => {
    const t = today();
    await fillSchedule(addDays(t, 1), 2, "admin");
    const before = await db.query("select id from daily_challenges order by challenge_date");
    // Leave only the scheduled questions approved, then archive one of them.
    for (const q of await eligiblePool(db)) await db.query("update questions set status = 'archived' where id = $1", [q.id]);
    await db.query(
      "update questions set status = 'archived' where id = (select question_id from challenge_questions order by question_id limit 1)",
    );
    await expect(rebuildUpcoming("admin")).rejects.toMatchObject({ code: "short" });
    expect(await db.query("select id from daily_challenges order by challenge_date")).toEqual(before);
  });
});
