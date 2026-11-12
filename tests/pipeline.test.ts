import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { updateSettings } from "@/lib/server/admin/settings";
import { advanceJob, createJob, decide, setSourceCheckerForTests } from "@/lib/server/ai/pipeline";
import { setAiProviderForTests, type AiProvider, type CallUsage } from "@/lib/server/ai/provider";
import type { Proposal, Research } from "@/lib/server/ai/schemas";
import { eligiblePool } from "@/lib/server/challenges";
import type { SourceCheck } from "@/lib/server/source-check";
import { fakeClock, freshDb, resetClock } from "./support/db";

const usage = (purpose: string): CallUsage => ({ purpose, model: "fake", inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, webSearches: 1, costUsd: 0.05 });

function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    prompt: "How many strings does a standard violin have?", answer: 4, unit: "strings", category: "entertainment", difficulty: "easy",
    scoring_type: "absolute", tolerance: 1.5, allow_decimal: false, allow_negative: false,
    explanation: "Four strings tuned G, D, A and E.", subject: "violin strings", reference_period: null, why_estimable: "common knowledge", suggested_source_url: null,
    ...over,
  };
}
function research(over: Partial<Research> = {}): Research {
  return {
    verdict: "supported", source_url: "https://www.example-orchestra.org/violin", source_title: "The violin", source_type: "primary",
    excerpt: "The violin has four strings tuned in perfect fifths.", value_in_source: 4, unit_in_source: "strings", reference_period: null,
    matches_wording: true, ambiguity_notes: "", is_ambiguous: false, family_friendly: true, suggested_difficulty: "easy",
    conflicting_sources: false, notes: "",
    ...over,
  };
}
const supported: SourceCheck = { status: "supported", detail: "ok", checkedAt: "" };

class FakeProvider implements AiProvider {
  name = "fake";
  model = "fake";
  researchCalls = 0;
  constructor(public proposals: unknown[], public researchFor: (p: Proposal) => Research) {}
  async propose(input: { count: number }) {
    const out = this.proposals.splice(0, input.count);
    return { proposals: out, usage: [usage("propose")] };
  }
  async research(p: Proposal) {
    this.researchCalls++;
    return { research: this.researchFor(p), usage: [usage("research")] };
  }
}

let db: Db;
beforeEach(async () => {
  fakeClock("2026-11-11T20:00:00Z");
  db = await freshDb();
  setSourceCheckerForTests(async () => supported);
});
afterEach(async () => {
  setAiProviderForTests(null);
  setSourceCheckerForTests(null);
  resetClock();
  await db.close();
});

const params = { quantity: 1, categories: [], difficulty: { easy: 40, medium: 40, hard: 20 }, instructions: "" };

describe("generation pipeline", () => {
  it("is disabled without credentials", async () => {
    await expect(createJob(params, "admin")).rejects.toMatchObject({ code: "ai_not_configured" });
  });

  it("accepts well-supported candidates into the review queue (not auto-published)", async () => {
    setAiProviderForTests(new FakeProvider([proposal()], () => research()));
    const id = await createJob(params, "admin");
    const job = await advanceJob(id, 10_000);
    expect(job!.status).toBe("completed");
    expect(job!.accepted_count).toBe(1);
    const q = await db.one<{ status: string; verification_status: string; provenance: string; source_excerpt: string }>(
      "select status, verification_status, provenance, source_excerpt from questions where provenance = 'ai'",
    );
    expect(q).toMatchObject({ status: "review", verification_status: "auto_passed", provenance: "ai" });
    expect(job!.estimated_cost_usd).toBeGreaterThan(0);
    const log = await db.query("select * from ai_usage");
    expect(log.length).toBe(2);
  });

  it("auto-approves only when the admin enabled it", async () => {
    await updateSettings({ autoApprove: true }, "admin");
    setAiProviderForTests(new FakeProvider([proposal()], () => research()));
    await advanceJob(await createJob(params, "admin"), 10_000);
    const q = await db.one<{ status: string; verified_at: Date }>("select status, verified_at from questions where provenance = 'ai'");
    expect(q!.status).toBe("approved");
    expect(q!.verified_at).toBeTruthy();
  });

  it("holds candidates whose source can't be independently confirmed", async () => {
    await updateSettings({ autoApprove: true }, "admin");
    setSourceCheckerForTests(async () => ({ status: "excerpt_not_found", detail: "The quoted excerpt was not found on the fetched page.", checkedAt: "" }));
    setAiProviderForTests(new FakeProvider([proposal()], () => research()));
    const job = await advanceJob(await createJob(params, "admin"), 10_000);
    expect(job!.held_count).toBe(1);
    const q = await db.one<{ status: string; verification_status: string }>("select status, verification_status from questions where provenance = 'ai'");
    expect(q).toMatchObject({ status: "review", verification_status: "needs_review" });
    // held content is never schedulable
    expect((await eligiblePool(db, false)).length).toBe(0);
  });

  it("holds contradicted, conflicting or unsupported evidence even if a model agrees", async () => {
    setAiProviderForTests(
      new FakeProvider([proposal(), proposal({ prompt: "How many keys does a full-size accordion have on the right side?", subject: "accordion keys", answer: 41 })], (p) =>
        p.answer === 4 ? research({ verdict: "contradicted", value_in_source: 5 }) : research({ verdict: "supported", conflicting_sources: true, value_in_source: 41, excerpt: "has 41 keys on the treble side" }),
      ),
    );
    const job = await advanceJob(await createJob({ ...params, quantity: 2 }, "admin"), 10_000);
    expect(job!.held_count).toBe(2);
    expect(job!.accepted_count).toBe(0);
    const reasons = await db.query<{ reasons: string[] }>("select reasons from generation_candidates order by batch_index");
    expect(reasons[0].reasons.join(" ")).toMatch(/contradicts/);
    expect(reasons[1].reasons.join(" ")).toMatch(/conflict/);
  });

  it("rejects unsafe and duplicate ideas before paying for research", async () => {
    const fake = new FakeProvider(
      [
        proposal({ prompt: "What is the net worth of the richest pop star?", subject: "pop star net worth", category: "entertainment" }),
        proposal({ prompt: "How many keys are on a standard modern piano?", subject: "piano keys", answer: 88, scoring_type: "ratio", tolerance: 1.25 }),
        { prompt: 42, nonsense: true },
      ],
      () => research(),
    );
    setAiProviderForTests(fake);
    const job = await advanceJob(await createJob({ ...params, quantity: 3 }, "admin"), 10_000);
    expect(fake.researchCalls).toBe(0);
    const rows = await db.query<{ status: string; reasons: string[] }>("select status, reasons from generation_candidates order by batch_index");
    expect(rows.slice(0, 3).map((r) => r.status)).toEqual(["rejected", "rejected", "rejected"]);
    expect(rows[0].reasons.join(" ")).toMatch(/net-worth/i);
    expect(rows[1].reasons.join(" ")).toMatch(/Duplicate/);
    expect(rows[2].reasons.join(" ")).toMatch(/structure/);
    // proposals are capped at 2x the target, so the job ends instead of looping
    expect(job!.proposed_count).toBeLessThanOrEqual(6);
    expect(job!.status).toBe("completed");
  });

  it("pauses when the monthly cost limit is reached", async () => {
    await updateSettings({ monthlyCostLimitUsd: 0.06 }, "admin");
    setAiProviderForTests(new FakeProvider([proposal(), proposal({ prompt: "How many legs does an ant have?", subject: "ant legs", answer: 6 })], () => research()));
    const job = await advanceJob(await createJob({ ...params, quantity: 2 }, "admin"), 10_000);
    expect(job!.status).toBe("paused");
    expect(job!.progress_note).toMatch(/cost limit/);
  });

  it("decides with explicit reasons", () => {
    const d = decide(proposal(), research({ source_url: "https://www.reddit.com/r/x" }), supported, []);
    expect(d.status).toBe("held");
    expect(d.reasons.join(" ")).toMatch(/not a reliable reference/);
    expect(decide(proposal(), research({ family_friendly: false }), supported, []).status).toBe("rejected");
    expect(decide(proposal(), research(), supported, []).status).toBe("accepted");
  });
});

describe("production approval gates", () => {
  it("excludes demo content from scheduling when demo content is not allowed", async () => {
    expect((await eligiblePool(db, true)).length).toBeGreaterThan(20);
    expect((await eligiblePool(db, false)).length).toBe(0);
  });
});
