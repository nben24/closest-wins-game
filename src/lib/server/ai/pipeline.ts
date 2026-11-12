import "server-only";
import crypto from "node:crypto";
import { getDb, type Sql } from "@/lib/db";
import { runContentChecks, type CheckResult, type QuestionDraft } from "@/lib/content-checks";
import { mostSimilar, NEAR_DUPLICATE_THRESHOLD, normalizePrompt, normalizeSubject } from "@/lib/similarity";
import { getSettings, type AppSettings } from "@/lib/server/admin/settings";
import { AiError, getAiProvider, type AiProvider, type CallUsage } from "@/lib/server/ai/provider";
import { ProposalSchema, type Proposal, type Research } from "@/lib/server/ai/schemas";
import { now } from "@/lib/server/clock";
import { ApiError } from "@/lib/server/errors";
import { audit, notifyAdmin } from "@/lib/server/notify";
import { checkSource, type SourceCheck } from "@/lib/server/source-check";

/**
 * Durable, resumable generation jobs.
 *
 * A job is advanced in small, bounded steps (one proposal batch or one
 * candidate verification per step). Any caller — the admin page while open,
 * the request that created the job (via after()), or the cron endpoint — can
 * advance it. A lease row lock ensures only one worker runs a job at a time,
 * and a crashed worker's lease simply expires. Nothing loops unbounded:
 *   - proposals are capped at 2× the target,
 *   - API calls per job, retries per candidate, monthly questions and the
 *     monthly estimated cost are all checked before every call.
 *
 * Pipeline per candidate:
 *   1. propose (structured output, no tools)
 *   2. cheap local checks: schema, content rules, exact/near duplicates
 *   3. research with web search + fetch (model reports source, verbatim excerpt, value)
 *   4. independent verification: we fetch the cited page ourselves and require
 *      the excerpt to be on it and to contain the answer. A second model
 *      agreeing is never treated as sufficient.
 *   5. decide: accepted (→ review queue, or approved if auto-approve is on),
 *      held for review (unsupported / conflicting / inaccessible / ambiguous),
 *      or rejected (unsafe, invalid, duplicate) — always with reasons.
 */

export const MAX_BATCH = 5;
const LEASE_SECONDS = 120;

export interface JobParams {
  quantity: number;
  categories: string[];
  difficulty: { easy: number; medium: number; hard: number };
  instructions: string;
}

export interface JobRow {
  id: string;
  status: "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
  trigger: "manual" | "auto";
  params: JobParams;
  target_count: number;
  proposed_count: number;
  accepted_count: number;
  held_count: number;
  rejected_count: number;
  api_calls: number;
  input_tokens: number;
  output_tokens: number;
  web_searches: number;
  estimated_cost_usd: number;
  progress_note: string | null;
  error: string | null;
  created_at: Date;
  finished_at: Date | null;
}

interface CandidateRow {
  id: string;
  job_id: string;
  status: "proposed" | "accepted" | "held" | "rejected" | "failed";
  attempts: number;
  proposal: Proposal;
  research: Research | null;
  reasons: string[];
  normalized_prompt: string;
}

// --- source checker injection (tests) ---------------------------------------
let sourceChecker: (url: string | null, excerpt: string | null, answer: number) => Promise<SourceCheck> = checkSource;
export function setSourceCheckerForTests(fn: typeof checkSource | null): void {
  sourceChecker = fn ?? checkSource;
}

// --- budgets ------------------------------------------------------------------

function monthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export async function monthlyUsage(sql?: Sql): Promise<{ costUsd: number; proposals: number; calls: number }> {
  const db = sql ?? (await getDb());
  const since = monthStart(now());
  const cost = await db.one<{ c: number; n: number }>(
    "select coalesce(sum(estimated_cost_usd), 0)::float8 as c, count(*)::int as n from ai_usage where created_at >= $1",
    [since],
  );
  const props = await db.one<{ n: number }>("select count(*)::int as n from generation_candidates where created_at >= $1", [since]);
  return { costUsd: cost!.c, calls: cost!.n, proposals: props!.n };
}

async function budgetProblem(sql: Sql, job: JobRow, s: AppSettings, plannedProposals = 0): Promise<string | null> {
  if (job.api_calls >= s.maxApiCallsPerJob) return `This job reached its limit of ${s.maxApiCallsPerJob} API calls.`;
  const m = await monthlyUsage(sql);
  if (m.costUsd >= s.monthlyCostLimitUsd) return `Monthly estimated AI cost limit reached ($${m.costUsd.toFixed(2)} of $${s.monthlyCostLimitUsd}).`;
  if (m.proposals + plannedProposals > s.monthlyQuestionLimit) return `Monthly question generation limit reached (${m.proposals} of ${s.monthlyQuestionLimit}).`;
  return null;
}

async function recordUsage(sql: Sql, jobId: string, candidateId: string | null, usage: CallUsage[], error?: string): Promise<void> {
  for (const u of usage) {
    await sql.query(
      `insert into ai_usage (job_id, candidate_id, purpose, model, input_tokens, output_tokens, cache_read_tokens, web_searches, estimated_cost_usd, ok, error)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [jobId, candidateId, u.purpose, u.model, u.inputTokens, u.outputTokens, u.cacheReadTokens, u.webSearches, u.costUsd, !error, error ?? null],
    );
  }
  const sum = usage.reduce(
    (a, u) => ({ calls: a.calls + 1, i: a.i + u.inputTokens, o: a.o + u.outputTokens, w: a.w + u.webSearches, c: a.c + u.costUsd }),
    { calls: 0, i: 0, o: 0, w: 0, c: 0 },
  );
  // A failed call with no usage still counts against the call limit.
  const calls = Math.max(sum.calls, error ? 1 : 0);
  await sql.query(
    `update generation_jobs set api_calls = api_calls + $2, input_tokens = input_tokens + $3, output_tokens = output_tokens + $4,
       web_searches = web_searches + $5, estimated_cost_usd = estimated_cost_usd + $6, updated_at = now() where id = $1`,
    [jobId, calls, sum.i, sum.o, sum.w, sum.c],
  );
}

// --- job creation ---------------------------------------------------------------

export async function createJob(params: JobParams, actor: string, trigger: "manual" | "auto" = "manual"): Promise<string> {
  if (!getAiProvider()) throw new ApiError(503, "ai_not_configured", "AI generation is unavailable: ANTHROPIC_API_KEY is not configured.");
  const s = await getSettings();
  const quantity = Math.max(1, Math.min(Math.floor(params.quantity), s.maxQuestionsPerJob));
  const db = await getDb();
  const m = await monthlyUsage(db);
  if (m.proposals >= s.monthlyQuestionLimit) throw new ApiError(409, "monthly_limit", "This month's generation limit has been reached.");
  if (m.costUsd >= s.monthlyCostLimitUsd) throw new ApiError(409, "monthly_cost", "This month's estimated AI cost limit has been reached.");
  const running = await db.one<{ n: number }>("select count(*)::int as n from generation_jobs where status in ('queued','running')");
  if (running!.n >= 3) throw new ApiError(409, "too_many_jobs", "Three jobs are already queued or running. Wait for one to finish.");
  const clean: JobParams = {
    quantity,
    categories: params.categories.length ? params.categories : ["everyday", "food", "animals", "entertainment", "geography", "products", "sports", "science"],
    difficulty: params.difficulty,
    instructions: params.instructions.slice(0, 1000),
  };
  const r = await db.one<{ id: string }>(
    "insert into generation_jobs (params, target_count, trigger, requested_by) values ($1, $2, $3, $4) returning id",
    [JSON.stringify(clean), quantity, trigger, actor],
  );
  await audit(actor, "create_job", "generation_job", r!.id, { ...clean });
  return r!.id;
}

export async function cancelJob(jobId: string, actor: string): Promise<void> {
  const db = await getDb();
  await db.query(
    "update generation_jobs set status = 'cancelled', finished_at = now(), lease_until = null, updated_at = now() where id = $1 and status in ('queued','running','paused')",
    [jobId],
  );
  await audit(actor, "cancel_job", "generation_job", jobId);
}

export async function resumeJob(jobId: string, actor: string): Promise<void> {
  const db = await getDb();
  await db.query("update generation_jobs set status = 'queued', error = null, progress_note = 'Resumed', updated_at = now() where id = $1 and status in ('paused','failed')", [jobId]);
  await audit(actor, "resume_job", "generation_job", jobId);
}

// --- advancing --------------------------------------------------------------------

async function acquireLease(jobId: string, owner: string): Promise<JobRow | null> {
  const db = await getDb();
  return db.one<JobRow>(
    `update generation_jobs set lease_owner = $2, lease_until = $3, status = 'running', started_at = coalesce(started_at, $4), updated_at = now()
      where id = $1 and status in ('queued','running') and (lease_until is null or lease_until < $4 or lease_owner = $2)
      returning *`,
    [jobId, owner, new Date(now().getTime() + LEASE_SECONDS * 1000), now()],
  );
}

async function releaseLease(jobId: string, owner: string): Promise<void> {
  const db = await getDb();
  await db.query("update generation_jobs set lease_owner = null, lease_until = null where id = $1 and lease_owner = $2", [jobId, owner]);
}

async function setJob(jobId: string, patch: { status?: JobRow["status"]; progress_note?: string; error?: string | null }) {
  const db = await getDb();
  const finished = patch.status && ["completed", "failed", "cancelled", "paused"].includes(patch.status);
  await db.query(
    `update generation_jobs set status = coalesce($2, status), progress_note = coalesce($3, progress_note), error = $4,
       finished_at = case when $5 then now() else finished_at end, updated_at = now() where id = $1`,
    [jobId, patch.status ?? null, patch.progress_note ?? null, patch.error ?? null, Boolean(finished && patch.status !== "paused")],
  );
}

/**
 * Advance a job for at most `budgetMs`. Returns the job afterwards.
 * Safe to call concurrently: only the lease holder does work.
 */
export async function advanceJob(jobId: string, budgetMs = 40_000): Promise<JobRow | null> {
  const owner = crypto.randomUUID();
  const started = Date.now();
  const provider = getAiProvider();
  const db = await getDb();
  if (!provider) {
    await setJob(jobId, { status: "paused", error: "ANTHROPIC_API_KEY is not configured." });
    return db.one<JobRow>("select * from generation_jobs where id = $1", [jobId]);
  }
  let job = await acquireLease(jobId, owner);
  if (!job) return db.one<JobRow>("select * from generation_jobs where id = $1", [jobId]);
  try {
    // Each step can take ~30–90s with web research; only start one if there's room.
    while (Date.now() - started < budgetMs) {
      const s = await getSettings();
      job = (await db.one<JobRow>("select * from generation_jobs where id = $1", [jobId]))!;
      if (job.status !== "running") break;
      const done = await step(job, s, provider);
      await db.query("update generation_jobs set lease_until = $2 where id = $1 and lease_owner = $3", [
        jobId,
        new Date(now().getTime() + LEASE_SECONDS * 1000),
        owner,
      ]);
      if (done) break;
    }
  } catch (e) {
    await setJob(jobId, { status: "failed", error: e instanceof Error ? e.message.slice(0, 500) : "Unknown error" });
    await notifyAdmin("job_failed", "error", `Generation job failed: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}`, `job_failed:${jobId}`);
  } finally {
    await releaseLease(jobId, owner);
  }
  return db.one<JobRow>("select * from generation_jobs where id = $1", [jobId]);
}

/** One bounded unit of work. Returns true when the job should stop for now. */
async function step(job: JobRow, s: AppSettings, provider: AiProvider): Promise<boolean> {
  const db = await getDb();
  const pending = await db.one<CandidateRow>(
    "select * from generation_candidates where job_id = $1 and status = 'proposed' order by created_at, batch_index limit 1",
    [job.id],
  );
  if (pending) {
    const problem = await budgetProblem(db, job, s);
    if (problem) {
      await setJob(job.id, { status: "paused", progress_note: problem });
      await notifyAdmin("budget", "warning", problem, `budget:${job.id}`);
      return true;
    }
    await verifyCandidate(job, pending, s, provider);
    return false;
  }

  const good = job.accepted_count + job.held_count;
  const remaining = job.target_count - good;
  if (remaining <= 0 || job.proposed_count >= job.target_count * 2) {
    const note = remaining <= 0 ? "Finished." : `Stopped after ${job.proposed_count} proposals (limit: 2× target).`;
    await setJob(job.id, { status: "completed", progress_note: note });
    await db.query("update generation_jobs set finished_at = now() where id = $1", [job.id]);
    if (good > 0) await notifyAdmin("review_ready", "info", `${good} new AI question(s) are waiting in the review queue.`, "review_ready");
    return true;
  }
  const batchSize = Math.min(MAX_BATCH, remaining + 1, job.target_count * 2 - job.proposed_count);
  const problem = await budgetProblem(db, job, s, batchSize);
  if (problem) {
    await setJob(job.id, { status: "paused", progress_note: problem });
    await notifyAdmin("budget", "warning", problem, `budget:${job.id}`);
    return true;
  }
  await proposeBatch(job, batchSize, s, provider);
  return false;
}

async function proposeBatch(job: JobRow, count: number, s: AppSettings, provider: AiProvider): Promise<void> {
  const db = await getDb();
  const subjects = await db.query<{ s: string }>(
    "select coalesce(nullif(subject_key, ''), left(prompt, 60)) as s from questions where status <> 'rejected' order by created_at desc limit 400",
  );
  const jobSubjects = await db.query<{ s: string }>("select proposal->>'subject' as s from generation_candidates where job_id = $1", [job.id]);
  await setJob(job.id, { progress_note: `Proposing ${count} question idea(s)…` });
  let result: Awaited<ReturnType<AiProvider["propose"]>>;
  try {
    result = await provider.propose({
      count,
      categories: job.params.categories,
      difficulty: job.params.difficulty,
      instructions: job.params.instructions,
      avoidSubjects: [...subjects, ...jobSubjects].map((r) => r.s).filter(Boolean),
      maxTokens: s.maxOutputTokensPerCall,
    });
  } catch (e) {
    const err = e instanceof AiError ? e : new AiError("Proposal failed.");
    await recordUsage(db, job.id, null, err.usage, err.message);
    if (!err.retryable) throw err;
    await setJob(job.id, { progress_note: `Proposal attempt failed (${err.message}); will retry.` });
    // bounded by the per-job API call limit
    return;
  }
  await recordUsage(db, job.id, null, result.usage);
  if (result.proposals.length === 0) {
    await setJob(job.id, { status: "completed", progress_note: "The model returned no new ideas for these settings." });
    return;
  }
  let i = 0;
  for (const raw of result.proposals.slice(0, count)) {
    const parsed = ProposalSchema.safeParse(raw);
    const proposal = parsed.success ? parsed.data : (raw as Proposal);
    const reasons = parsed.success ? [] : ["Proposal did not match the required structure."];
    await db.query(
      `insert into generation_candidates (job_id, batch_index, status, proposal, reasons, normalized_prompt)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        job.id,
        job.proposed_count + i,
        parsed.success ? "proposed" : "rejected",
        JSON.stringify(proposal),
        JSON.stringify(reasons),
        normalizePrompt(String((raw as { prompt?: unknown })?.prompt ?? "")),
      ],
    );
    i++;
  }
  await db.query(
    `update generation_jobs set proposed_count = proposed_count + $2, rejected_count = rejected_count + $3, updated_at = now() where id = $1`,
    [job.id, i, result.proposals.slice(0, count).filter((r) => !ProposalSchema.safeParse(r).success).length],
  );
}

function proposalToDraft(p: Proposal, r?: Research | null): QuestionDraft {
  return {
    prompt: p.prompt,
    answer: p.answer,
    unit: p.unit,
    category: p.category,
    difficulty: p.difficulty,
    scoringType: p.scoring_type,
    tolerance: p.tolerance,
    allowDecimal: p.allow_decimal,
    allowNegative: p.allow_negative,
    explanation: p.explanation,
    sourceUrl: r?.source_url ?? null,
    sourceTitle: r?.source_title ?? null,
    sourceExcerpt: r?.excerpt ?? null,
    referencePeriod: r?.reference_period ?? p.reference_period,
  };
}

const LOW_QUALITY_DOMAINS = /(^|\.)(quora\.com|reddit\.com|pinterest\.[a-z.]+|answers\.com|fandom\.com|medium\.com|tiktok\.com|facebook\.com|x\.com|twitter\.com|youtube\.com|blogspot\.com|wordpress\.com)$/i;

function valuesMatch(expected: number, found: number | null): boolean {
  if (found === null || !Number.isFinite(found)) return false;
  if (expected === found) return true;
  const tol = Math.max(Math.abs(expected) * 0.005, Number.isInteger(expected) ? 0 : 0.05);
  return Math.abs(expected - found) <= tol;
}

export type Decision = { status: "accepted" | "held" | "rejected"; reasons: string[]; checks: CheckResult[]; verification: "auto_passed" | "needs_review" | "failed" };

/** Pure decision logic (unit-tested). */
export function decide(p: Proposal, research: Research, source: SourceCheck, duplicates: { prompt: string; score: number }[]): Decision {
  const draft = proposalToDraft(p, research);
  const checks = runContentChecks(draft);
  const reasons: string[] = [];
  const hard: string[] = [];

  if (!research.family_friendly) hard.push("Not family friendly (research step).");
  for (const c of checks.filter((c) => c.level === "error")) {
    if (c.code === "family_suitability" || c.code === "celebrity_wealth" || c.code === "scoring") hard.push(c.message);
    else reasons.push(c.message);
  }
  const dup = duplicates.find((d) => d.score >= NEAR_DUPLICATE_THRESHOLD);
  if (dup) hard.push(`Duplicate of an existing question: "${dup.prompt}" (similarity ${dup.score.toFixed(2)}).`);
  if (hard.length) return { status: "rejected", reasons: hard, checks, verification: "failed" };

  if (research.verdict === "contradicted") reasons.push(`Source contradicts the proposed answer (source says ${research.value_in_source ?? "a different value"} ${research.unit_in_source ?? ""}).`);
  if (research.verdict === "not_found") reasons.push("No supporting source was found.");
  if (research.verdict === "unclear") reasons.push("Evidence was unclear.");
  if (research.conflicting_sources) reasons.push("Sources conflict.");
  if (research.is_ambiguous) reasons.push(`Possibly ambiguous: ${research.ambiguity_notes || "see notes"}`);
  if (!research.matches_wording) reasons.push("Evidence does not match the question's wording, unit or period exactly.");
  if (!valuesMatch(p.answer, research.value_in_source)) reasons.push(`Value in source (${research.value_in_source ?? "none"}) does not match the answer (${p.answer}).`);
  if (research.source_url) {
    try {
      const host = new URL(research.source_url).hostname;
      if (LOW_QUALITY_DOMAINS.test(host)) reasons.push(`Source domain ${host} is not a reliable reference.`);
    } catch {
      reasons.push("Source URL is malformed.");
    }
  }
  if (source.status !== "supported") reasons.push(`Independent check: ${source.detail}`);
  if (checks.some((c) => c.level === "warning")) reasons.push(...checks.filter((c) => c.level === "warning").map((c) => `Warning: ${c.message}`));

  if (reasons.length) return { status: "held", reasons, checks, verification: "needs_review" };
  return { status: "accepted", reasons: [], checks, verification: "auto_passed" };
}

async function verifyCandidate(job: JobRow, c: CandidateRow, s: AppSettings, provider: AiProvider): Promise<void> {
  const db = await getDb();
  const p = c.proposal;
  await db.query("update generation_candidates set attempts = attempts + 1, updated_at = now() where id = $1", [c.id]);
  await setJob(job.id, { progress_note: `Checking: "${p.prompt.slice(0, 80)}"` });

  // Cheap checks first — don't pay for research on something we'd reject anyway.
  const existing = await db.query<{ id: string; prompt: string; subject_key: string; normalized_prompt: string }>(
    "select id, prompt, subject_key, normalized_prompt from questions where status in ('draft','review','approved','archived')",
  );
  const siblings = await db.query<{ prompt: string }>(
    "select proposal->>'prompt' as prompt from generation_candidates where job_id = $1 and id <> $2 and status in ('accepted','held')",
    [job.id, c.id],
  );
  const norm = normalizePrompt(p.prompt);
  const subj = normalizeSubject(p.subject);
  const exact = existing.find((e) => e.normalized_prompt === norm || (subj && e.subject_key === subj));
  const dupHits = [
    ...(exact ? [{ prompt: exact.prompt, score: 1 }] : []),
    ...mostSimilar(p.prompt, [...existing, ...siblings], (e) => e.prompt, 3).map((h) => ({ prompt: h.item.prompt, score: h.score })),
  ];
  const pre = runContentChecks({ ...proposalToDraft(p), sourceUrl: "https://placeholder.invalid", sourceTitle: "x", sourceExcerpt: "x" });
  const preHard = pre.filter((x) => x.level === "error" && ["family_suitability", "celebrity_wealth", "scoring", "prompt_long", "category", "difficulty"].includes(x.code));
  const preDup = dupHits.find((d) => d.score >= NEAR_DUPLICATE_THRESHOLD);
  if (preHard.length || preDup) {
    const reasons = [...preHard.map((x) => x.message), ...(preDup ? [`Duplicate of an existing question: "${preDup.prompt}".`] : [])];
    await finishCandidate(job, c, "rejected", reasons, pre, null, null, "failed", s);
    return;
  }

  let research: Research;
  try {
    const r = await provider.research(p, s.maxOutputTokensPerCall);
    await recordUsage(db, job.id, c.id, r.usage);
    research = r.research;
  } catch (e) {
    const err = e instanceof AiError ? e : new AiError("Research failed.");
    await recordUsage(db, job.id, c.id, err.usage, err.message);
    if (!err.retryable || c.attempts + 1 > s.maxRetriesPerCandidate) {
      await finishCandidate(job, c, "held", [`Research could not be completed: ${err.message}`], pre, null, null, "needs_review", s);
    }
    return; // otherwise stays 'proposed' and is retried on a later step
  }

  const source = research.source_url && research.excerpt
    ? await sourceChecker(research.source_url, research.excerpt, p.answer)
    : ({ status: "invalid_url", detail: "The research step returned no source URL or excerpt.", checkedAt: now().toISOString() } as SourceCheck);
  const d = decide(p, research, source, dupHits);
  await finishCandidate(job, c, d.status, d.reasons, d.checks, research, source, d.verification, s);
}

async function finishCandidate(
  job: JobRow,
  c: CandidateRow,
  status: "accepted" | "held" | "rejected",
  reasons: string[],
  checks: CheckResult[],
  research: Research | null,
  source: SourceCheck | null,
  verification: "auto_passed" | "needs_review" | "failed",
  s: AppSettings,
): Promise<void> {
  const db = await getDb();
  await db.tx(async (sql) => {
    let questionId: string | null = null;
    if (status !== "rejected") {
      const p = c.proposal;
      const draft = proposalToDraft(p, research);
      const autoApprove = status === "accepted" && s.autoApprove && source?.status === "supported" && !checks.some((x) => x.level !== "info");
      const notes = [
        ...reasons.map((m) => ({ level: status === "held" ? "warning" : "info", message: m })),
        ...(source ? [{ level: source.status === "supported" ? "info" : "warning", message: `Source check: ${source.detail}` }] : []),
        ...(research ? [{ level: "info", message: `Research verdict: ${research.verdict}; source type: ${research.source_type}. ${research.notes}`.slice(0, 600) }] : []),
        ...(research && research.suggested_difficulty !== p.difficulty
          ? [{ level: "info", message: `Research step suggests difficulty "${research.suggested_difficulty}" (proposed "${p.difficulty}").` }]
          : []),
      ];
      const inserted = await sql.query<{ id: string }>(
        `insert into questions (prompt, answer, unit, category, difficulty, scoring_type, tolerance, allow_decimal, allow_negative,
            explanation, source_url, source_title, source_excerpt, reference_period, subject_key, normalized_prompt, status,
            verification_status, verification_notes, verified_at, provenance, generation_job_id, candidate_id, created_by,
            approved_at, approved_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'ai',$21,$22,'ai-pipeline',$23,$24)
         on conflict do nothing returning id`,
        [
          draft.prompt.trim(), draft.answer, draft.unit, draft.category, draft.difficulty,
          draft.scoringType, draft.tolerance, draft.allowDecimal, draft.allowNegative, draft.explanation.slice(0, 600),
          draft.sourceUrl, draft.sourceTitle, draft.sourceExcerpt?.slice(0, 2000) ?? null, draft.referencePeriod,
          normalizeSubject(p.subject || p.prompt), normalizePrompt(p.prompt), autoApprove ? "approved" : "review",
          verification, JSON.stringify(notes), source?.status === "supported" ? now() : null, job.id, c.id,
          autoApprove ? now() : null, autoApprove ? "auto-approve" : null,
        ],
      );
      questionId = inserted[0]?.id ?? null;
      if (!questionId) {
        status = "rejected";
        reasons = [...reasons, "Duplicate wording of a live question."];
      } else if (autoApprove) {
        await sql.query(
          "insert into audit_log (actor, action, entity_type, entity_id, details) values ('system', 'auto_approve', 'question', $1, $2)",
          [questionId, JSON.stringify({ jobId: job.id })],
        );
      }
    }
    await sql.query(
      `update generation_candidates set status = $2, reasons = $3, checks = $4, research = $5, question_id = $6, updated_at = now() where id = $1`,
      [c.id, status, JSON.stringify(reasons), JSON.stringify({ content: checks, source }), research ? JSON.stringify(research) : null, questionId],
    );
    const col = status === "accepted" ? "accepted_count" : status === "held" ? "held_count" : "rejected_count";
    await sql.query(`update generation_jobs set ${col} = ${col} + 1, updated_at = now() where id = $1`, [job.id]);
  });
}

/** Admin: re-run verification on a held/rejected/failed candidate (counts against limits). */
export async function reverifyCandidate(candidateId: string, actor: string): Promise<string> {
  const db = await getDb();
  const c = await db.one<CandidateRow & { question_id: string | null }>("select * from generation_candidates where id = $1", [candidateId]);
  if (!c) throw new ApiError(404, "not_found", "Candidate not found.");
  if (c.question_id) {
    const q = await db.one<{ status: string }>("select status from questions where id = $1", [c.question_id]);
    if (q?.status === "approved") throw new ApiError(400, "approved", "Already approved.");
    await db.query("update generation_candidates set question_id = null where id = $1", [candidateId]);
    await db.query("delete from questions where id = $1 and status in ('review','draft') and not exists (select 1 from challenge_questions where question_id = $1)", [c.question_id]);
  }
  const col = c.status === "accepted" ? "accepted_count" : c.status === "held" ? "held_count" : "rejected_count";
  await db.query(`update generation_jobs set ${col} = greatest(${col} - 1, 0), status = 'queued', finished_at = null, updated_at = now() where id = $1`, [c.job_id]);
  await db.query("update generation_candidates set status = 'proposed', attempts = 0, reasons = '[]', updated_at = now() where id = $1", [candidateId]);
  await audit(actor, "reverify_candidate", "generation_candidate", candidateId);
  return c.job_id;
}

/** Admin: generate a replacement idea for a candidate (new 1-question job). */
export async function regenerateCandidate(candidateId: string, actor: string): Promise<string> {
  const db = await getDb();
  const c = await db.one<CandidateRow>("select * from generation_candidates where id = $1", [candidateId]);
  if (!c) throw new ApiError(404, "not_found", "Candidate not found.");
  const p = c.proposal;
  const diff = { easy: p.difficulty === "easy" ? 100 : 0, medium: p.difficulty === "medium" ? 100 : 0, hard: p.difficulty === "hard" ? 100 : 0 };
  return createJob(
    {
      quantity: 1,
      categories: [p.category],
      difficulty: diff,
      instructions: `Replace this idea with a different, better-sourced question on a different subject: "${p.prompt}". Problems with it: ${(c.reasons ?? []).join("; ").slice(0, 400)}`,
    },
    actor,
  );
}

/** Admin: turn a rejected candidate into an editable draft question. */
export async function draftFromCandidate(candidateId: string, actor: string): Promise<string> {
  const db = await getDb();
  const c = await db.one<CandidateRow & { question_id: string | null }>("select * from generation_candidates where id = $1", [candidateId]);
  if (!c) throw new ApiError(404, "not_found", "Candidate not found.");
  if (c.question_id) return c.question_id;
  const p = c.proposal;
  const r = await db.one<{ id: string }>(
    `insert into questions (prompt, answer, unit, category, difficulty, scoring_type, tolerance, allow_decimal, allow_negative, explanation,
       source_url, source_title, source_excerpt, reference_period, subject_key, normalized_prompt, status, verification_status,
       verification_notes, provenance, generation_job_id, candidate_id, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'draft','unverified',$17,'ai',$18,$19,$20)
     on conflict do nothing returning id`,
    [
      String(p.prompt ?? "").slice(0, 300), Number(p.answer) || 0, String(p.unit ?? ""), p.category, p.difficulty, p.scoring_type, Number(p.tolerance) || 1.5,
      Boolean(p.allow_decimal), Boolean(p.allow_negative), String(p.explanation ?? "").slice(0, 600),
      c.research?.source_url ?? null, c.research?.source_title ?? null, c.research?.excerpt ?? null, c.research?.reference_period ?? p.reference_period ?? null,
      normalizeSubject(String(p.subject ?? p.prompt ?? "")), normalizePrompt(String(p.prompt ?? "")),
      JSON.stringify((c.reasons ?? []).map((m) => ({ level: "warning", message: m }))), c.job_id, c.id, actor,
    ],
  );
  if (!r) throw new ApiError(409, "duplicate", "A live question with this wording already exists.");
  await db.query("update generation_candidates set question_id = $2 where id = $1", [candidateId, r.id]);
  await audit(actor, "draft_from_candidate", "question", r.id, { candidateId });
  return r.id;
}

export async function listJobs(limit = 30): Promise<JobRow[]> {
  const db = await getDb();
  return db.query<JobRow>("select * from generation_jobs order by created_at desc limit $1", [limit]);
}

export async function getJob(id: string): Promise<{ job: JobRow; candidates: (CandidateRow & { question_id: string | null; checks: unknown })[] } | null> {
  const db = await getDb();
  const job = await db.one<JobRow>("select * from generation_jobs where id = $1", [id]);
  if (!job) return null;
  const candidates = await db.query<CandidateRow & { question_id: string | null; checks: unknown }>(
    "select * from generation_candidates where job_id = $1 order by batch_index",
    [id],
  );
  return { job, candidates };
}

/** Jobs that need work (for the cron worker). */
export async function runnableJobIds(): Promise<string[]> {
  const db = await getDb();
  return (await db.query<{ id: string }>(
    "select id from generation_jobs where status in ('queued','running') and (lease_until is null or lease_until < now()) order by created_at limit 3",
  )).map((r) => r.id);
}
