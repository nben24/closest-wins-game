import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { wordingChecks } from "@/lib/content-checks";
import { cleanPlayerPeriod } from "@/lib/format";
import { arithmeticProblems, relaxedBlockers } from "@/lib/server/ai/pipeline";
import { researchUserPrompt } from "@/lib/server/ai/prompts";
import type { Proposal, Research } from "@/lib/server/ai/schemas";
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

describe("wording traps", () => {
  const base = { answer: 73, scoringType: "ratio" as const, unit: "home runs", category: "sports", questionType: "record" };
  const codes = (q: Parameters<typeof wordingChecks>[0]) => wordingChecks(q).map((c) => c.code);

  it("flags 'in a season' when the answer is one specific season", () => {
    const bonds = { ...base, prompt: "How many home runs did Barry Bonds hit in a single MLB season?", referencePeriod: "2001 MLB season", sourceExcerpt: "He completed the 2001 season with 73 home runs." };
    expect(codes(bonds)).toEqual(["unnamed_instance"]);
    expect(codes({ ...bonds, prompt: "How many home runs did Barry Bonds hit in his record-setting 2001 MLB season?" })).toEqual([]);
    expect(codes({ ...bonds, prompt: "On average, how many steps does a US adult take in one day?", referencePeriod: "NHANES 2005-2006" })).toEqual([]);
    expect(codes({ ...bonds, prompt: "How many points did Wilt Chamberlain score in his famous record-setting single NBA game?", referencePeriod: "March 2, 1962" })).toEqual([]);
  });

  it("flags a source quote whose numbers don't include the answer", () => {
    const ticket = { prompt: "What was the average price of a movie theater ticket in the US in 1980, in dollars?", answer: 2.89, scoringType: "ratio" as const, unit: "dollars", category: "entertainment", questionType: "then_vs_now", referencePeriod: "1980", sourceExcerpt: "1979 | $2.47 1980 | $2.69 1981 | $2.78" };
    expect(codes(ticket)).toEqual(["excerpt_number"]);
    expect(codes({ ...ticket, answer: 2.69 })).toEqual([]);
    expect(codes({ ...ticket, sourceExcerpt: "Tickets cost 2,722 cents", answer: 2722 })).toEqual([]);
    expect(codes({ ...ticket, questionType: "runtime", sourceExcerpt: "Tech specs: Runtime 2 hours 4 minutes · Color", answer: 124 })).toEqual([]);
  });

  it("doesn't expect computed answers to appear in the quote", () => {
    const gap = { prompt: "How many years passed between the opening of the Brooklyn Bridge and the opening of the Golden Gate Bridge?", answer: 54, scoringType: "ratio" as const, unit: "years", category: "geography", questionType: "years_between", referencePeriod: "1883 to 1937", sourceExcerpt: "The Brooklyn Bridge opened on May 24, 1883." };
    expect(codes(gap)).toEqual([]);
  });

  it("blocks relaxed auto-approval for these traps", () => {
    const p = {
      prompt: "How many home runs did Barry Bonds hit in a single MLB season?", answer: 73, unit: "home runs", category: "sports", difficulty: "hard",
      scoring_type: "ratio", question_type: "record", tolerance: 1.8, allow_decimal: false, allow_negative: false, explanation: "x", subject: "bonds hr",
      reference_period: "2001 MLB season", why_estimable: "x", suggested_source_url: null,
    } as Proposal;
    const r = {
      verdict: "supported", source_url: "https://www.britannica.com/biography/Barry-Bonds", source_title: "Barry Bonds", source_type: "secondary",
      excerpt: "He completed the 2001 season with 73 home runs.", value_in_source: 73, unit_in_source: "home runs", reference_period: "2001 MLB season",
      matches_wording: true, ambiguity_notes: "", is_ambiguous: false, family_friendly: true, suggested_difficulty: "hard", conflicting_sources: false, notes: "",
    } as Research;
    expect(relaxedBlockers(p, r).join(" ")).toMatch(/one specific season/);
    expect(relaxedBlockers({ ...p, prompt: "How many home runs did Barry Bonds hit in his record-setting 2001 MLB season?" }, r)).toEqual([]);
  });
});

describe("accuracy checks", () => {
  const STEELERS = [6, 15, 11, 8, 10, 12, 9, 12, 12, 8, 8, 11, 10, 11, 13, 9, 8, 12, 9, 9, 10, 10];
  const seasons = STEELERS.map((v, i) => ({ label: String(2003 + i), value: v }));
  const p = {
    prompt: "How many regular-season games did the Pittsburgh Steelers win from 2003 through 2024 combined?", answer: 177, unit: "wins",
    category: "sports", difficulty: "medium", scoring_type: "ratio", question_type: "team_stats", tolerance: 1.5, reference_period: "2003-2024 NFL regular seasons",
  } as Proposal;
  const r = { value_in_source: 223, components: seasons, combine: "sum" } as Research;

  it("re-adds season totals and catches a wrong answer", () => {
    expect(arithmeticProblems(p, r).join(" ")).toMatch(/gives 223, but the question's answer is 177/);
    expect(arithmeticProblems({ ...p, answer: 223 }, r)).toEqual([]);
  });
  it("catches a missing season and a misreported total", () => {
    expect(arithmeticProblems({ ...p, answer: 213 }, { ...r, value_in_source: 213, components: seasons.slice(1) }).join(" ")).toMatch(/lists 21 seasons but the question covers 22/);
    expect(arithmeticProblems({ ...p, answer: 223 }, { ...r, value_in_source: 230 }).join(" ")).toMatch(/work out to 223, not the 230/);
  });
  it("requires a breakdown for totals and both years for gaps", () => {
    expect(arithmeticProblems({ ...p, answer: 223 }, { ...r, components: [], combine: "none" }).join(" ")).toMatch(/no season-by-season breakdown/);
    const gap = { prompt: "How many years passed between Jackie Robinson's MLB debut and Michael Jordan's first NBA championship?", answer: 44, question_type: "years_between", scoring_type: "ratio" } as Proposal;
    expect(arithmeticProblems(gap, { value_in_source: 44, combine: "difference", components: [{ label: "Robinson debut", value: 1947 }, { label: "Jordan title", value: 1991 }] } as Research)).toEqual([]);
    expect(arithmeticProblems({ ...gap, answer: 45 }, { value_in_source: 44, combine: "difference", components: [{ label: "a", value: 1947 }, { label: "b", value: 1991 }] } as Research)).not.toEqual([]);
  });
  it("never shows the fact-checker the proposed answer or explanation", () => {
    const text = researchUserPrompt({ ...p, explanation: "The Steelers won 177 games." } as Proposal & { explanation: string });
    expect(text).not.toContain("177");
    expect(text).toContain("Pittsburgh Steelers");
  });
  it("shows players a short time frame, never research notes", () => {
    expect(cleanPlayerPeriod("2001 MLB season")).toBe("2001 MLB season");
    expect(cleanPlayerPeriod("Not stated; current product label on a retailer page, one brand")).toBeNull();
    expect(cleanPlayerPeriod("None stated. The NPS page is undated.")).toBeNull();
    expect(cleanPlayerPeriod(null)).toBeNull();
  });
});
