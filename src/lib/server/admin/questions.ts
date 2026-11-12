import "server-only";
import { getDb, isUniqueViolation, type Sql } from "@/lib/db";
import { hasErrors, runContentChecks, type CheckResult, type QuestionDraft } from "@/lib/content-checks";
import { mostSimilar, NEAR_DUPLICATE_THRESHOLD, normalizePrompt, normalizeSubject } from "@/lib/similarity";
import type { ScoringType } from "@/lib/scoring";
import { now } from "@/lib/server/clock";
import { ApiError } from "@/lib/server/errors";
import { audit } from "@/lib/server/notify";
import { recomputeAttempt } from "@/lib/server/play";

export interface QuestionRow {
  id: string;
  prompt: string;
  answer: number;
  unit: string;
  category: string;
  difficulty: "easy" | "medium" | "hard";
  scoring_type: ScoringType;
  tolerance: number;
  allow_decimal: boolean;
  allow_negative: boolean;
  explanation: string;
  source_url: string | null;
  source_title: string | null;
  source_excerpt: string | null;
  reference_period: string | null;
  subject_key: string;
  status: "draft" | "review" | "approved" | "rejected" | "archived";
  verification_status: string;
  verification_notes: CheckResult[] | { level: string; message: string }[];
  verified_at: Date | null;
  provenance: "ai" | "manual" | "demo";
  is_demo: boolean;
  generation_job_id: string | null;
  review_notes: string | null;
  approved_at: Date | null;
  approved_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToDraft(q: QuestionRow): QuestionDraft {
  return {
    prompt: q.prompt,
    answer: q.answer,
    unit: q.unit,
    category: q.category,
    difficulty: q.difficulty,
    scoringType: q.scoring_type,
    tolerance: q.tolerance,
    allowDecimal: q.allow_decimal,
    allowNegative: q.allow_negative,
    explanation: q.explanation,
    sourceUrl: q.source_url,
    sourceTitle: q.source_title,
    sourceExcerpt: q.source_excerpt,
    referencePeriod: q.reference_period,
  };
}

export interface QuestionFilter {
  q?: string;
  status?: string;
  category?: string;
  difficulty?: string;
  provenance?: string;
  limit?: number;
  offset?: number;
}

export async function listQuestions(f: QuestionFilter): Promise<{ rows: (QuestionRow & { used_on: string | null })[]; total: number }> {
  const db = await getDb();
  const where: string[] = [];
  const vals: unknown[] = [];
  const add = (clause: string, v: unknown) => {
    vals.push(v);
    where.push(clause.replace("$?", `$${vals.length}`));
  };
  if (f.q) {
    vals.push(`%${f.q.slice(0, 100)}%`);
    const n = vals.length;
    where.push(`(q.prompt ilike $${n} or q.explanation ilike $${n} or q.subject_key ilike $${n})`);
  }
  if (f.status) add("q.status = $?", f.status);
  if (f.category) add("q.category = $?", f.category);
  if (f.difficulty) add("q.difficulty = $?", f.difficulty);
  if (f.provenance) add("q.provenance = $?", f.provenance);
  const w = where.length ? `where ${where.join(" and ")}` : "";
  const total = (await db.one<{ n: number }>(`select count(*)::int as n from questions q ${w}`, vals))!.n;
  vals.push(Math.min(f.limit ?? 50, 200), f.offset ?? 0);
  const rows = await db.query<QuestionRow & { used_on: string | null }>(
    `select q.*, (select min(dc.challenge_date)::text from challenge_questions cq join daily_challenges dc on dc.id = cq.challenge_id where cq.question_id = q.id) as used_on
       from questions q ${w} order by q.updated_at desc limit $${vals.length - 1} offset $${vals.length}`,
    vals,
  );
  return { rows, total };
}

export async function getQuestion(id: string): Promise<QuestionRow | null> {
  const db = await getDb();
  return db.one<QuestionRow>("select * from questions where id = $1", [id]);
}

export interface DuplicateHit {
  id: string;
  prompt: string;
  status: string;
  score: number;
}

/** Exact (normalized) and near duplicates among live questions. */
export async function findDuplicates(prompt: string, subject: string, excludeId?: string, sql?: Sql): Promise<DuplicateHit[]> {
  const db = sql ?? (await getDb());
  const rows = await db.query<{ id: string; prompt: string; status: string; subject_key: string; normalized_prompt: string }>(
    "select id, prompt, status, subject_key, normalized_prompt from questions where status in ('draft','review','approved','archived') and ($1::uuid is null or id <> $1::uuid)",
    [excludeId ?? null],
  );
  const norm = normalizePrompt(prompt);
  const subj = normalizeSubject(subject);
  const exact = rows.filter((r) => r.normalized_prompt === norm || (subj && r.subject_key === subj));
  const near = mostSimilar(prompt, rows, (r) => r.prompt, 5).filter((h) => h.score >= NEAR_DUPLICATE_THRESHOLD);
  const out = new Map<string, DuplicateHit>();
  for (const r of exact) out.set(r.id, { id: r.id, prompt: r.prompt, status: r.status, score: 1 });
  for (const h of near) if (!out.has(h.item.id)) out.set(h.item.id, { id: h.item.id, prompt: h.item.prompt, status: h.item.status, score: h.score });
  return [...out.values()];
}

export interface SaveInput extends QuestionDraft {
  subject: string;
}

/** Create a manual question. It enters the review queue like everything else. */
export async function createManualQuestion(input: SaveInput, actor: string): Promise<string> {
  const db = await getDb();
  try {
    const r = await db.one<{ id: string }>(
      `insert into questions (prompt, answer, unit, category, difficulty, scoring_type, tolerance, allow_decimal, allow_negative,
         explanation, source_url, source_title, source_excerpt, reference_period, subject_key, normalized_prompt,
         status, verification_status, verification_notes, provenance, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'review','unverified',$17,'manual',$18) returning id`,
      [
        input.prompt.trim(), input.answer, input.unit.trim(), input.category, input.difficulty, input.scoringType, input.tolerance,
        input.allowDecimal, input.allowNegative, input.explanation.trim(), input.sourceUrl, input.sourceTitle, input.sourceExcerpt,
        input.referencePeriod, normalizeSubject(input.subject || input.prompt), normalizePrompt(input.prompt),
        JSON.stringify(runContentChecks(input)), actor,
      ],
    );
    await audit(actor, "create", "question", r!.id, { provenance: "manual" });
    return r!.id;
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiError(409, "duplicate", "A live question with the same wording already exists.");
    throw e;
  }
}

/**
 * Edit a question. Questions already used in a published challenge keep their
 * published snapshot (players are never silently re-scored); use voidQuestion
 * for corrections there. Substantive edits to an approved question send it
 * back to review.
 */
export async function updateQuestion(id: string, input: SaveInput, actor: string): Promise<void> {
  const db = await getDb();
  await db.tx(async (sql) => {
    const q = await sql.one<QuestionRow>("select * from questions where id = $1 for update", [id]);
    if (!q) throw new ApiError(404, "not_found", "Question not found.");
    if (q.is_demo) throw new ApiError(400, "demo", "Demo questions can't be edited. Add a verified copy instead.");
    const substantive =
      q.prompt !== input.prompt.trim() || q.answer !== input.answer || q.unit !== input.unit.trim() || q.scoring_type !== input.scoringType ||
      q.tolerance !== input.tolerance || q.source_url !== input.sourceUrl || q.source_excerpt !== input.sourceExcerpt ||
      q.allow_decimal !== input.allowDecimal || q.allow_negative !== input.allowNegative;
    const nextStatus = substantive && q.status === "approved" ? "review" : q.status;
    try {
      await sql.query(
        `update questions set prompt=$2, answer=$3, unit=$4, category=$5, difficulty=$6, scoring_type=$7, tolerance=$8,
           allow_decimal=$9, allow_negative=$10, explanation=$11, source_url=$12, source_title=$13, source_excerpt=$14,
           reference_period=$15, subject_key=$16, normalized_prompt=$17, status=$18, verification_notes=$19,
           verification_status = case when $20 then 'unverified' else verification_status end,
           verified_at = case when $20 then null else verified_at end,
           approved_at = case when $18 = 'approved' then approved_at else null end, updated_at = now()
         where id = $1`,
        [
          id, input.prompt.trim(), input.answer, input.unit.trim(), input.category, input.difficulty, input.scoringType, input.tolerance,
          input.allowDecimal, input.allowNegative, input.explanation.trim(), input.sourceUrl, input.sourceTitle, input.sourceExcerpt,
          input.referencePeriod, normalizeSubject(input.subject || input.prompt), normalizePrompt(input.prompt), nextStatus,
          JSON.stringify(runContentChecks(input)), substantive,
        ],
      );
    } catch (e) {
      if (isUniqueViolation(e)) throw new ApiError(409, "duplicate", "A live question with the same wording already exists.");
      throw e;
    }
    await audit(actor, "update", "question", id, {
      substantive,
      before: { prompt: q.prompt, answer: q.answer, unit: q.unit, scoring: [q.scoring_type, q.tolerance], status: q.status },
      after: { prompt: input.prompt, answer: input.answer, unit: input.unit, scoring: [input.scoringType, input.tolerance], status: nextStatus },
    }, sql);
  });
}

export interface ApproveOptions {
  /** Admin confirms they personally checked the source supports the answer. */
  confirmedSource: boolean;
  acknowledgeWarnings: boolean;
}

/** Approve: requires no blocking check failures and an explicit source confirmation. */
export async function approveQuestion(id: string, actor: string, opts: ApproveOptions): Promise<void> {
  const db = await getDb();
  await db.tx(async (sql) => {
    const q = await sql.one<QuestionRow>("select * from questions where id = $1 for update", [id]);
    if (!q) throw new ApiError(404, "not_found", "Question not found.");
    if (q.is_demo) throw new ApiError(400, "demo", "Demo questions are already usable in demo mode and cannot be approved as verified content.");
    if (q.status === "approved") return;
    const checks = runContentChecks(rowToDraft(q));
    if (hasErrors(checks)) throw new ApiError(400, "checks_failed", `Fix the blocking problems first: ${checks.filter((c) => c.level === "error").map((c) => c.message).join(" ")}`);
    if (checks.some((c) => c.level === "warning") && !opts.acknowledgeWarnings) {
      throw new ApiError(400, "warnings", "Review and acknowledge the warnings before approving.");
    }
    if (!opts.confirmedSource) throw new ApiError(400, "confirm_source", "Confirm that you checked the source supports the answer.");
    const dups = (await findDuplicates(q.prompt, q.subject_key, q.id, sql)).filter((d) => d.status === "approved");
    if (dups.some((d) => d.score >= 0.95)) throw new ApiError(409, "duplicate", "An approved question is essentially identical.");
    await sql.query(
      `update questions set status = 'approved', approved_at = $2, approved_by = $3,
         verification_status = case when verification_status = 'auto_passed' then 'auto_passed' else 'admin_verified' end,
         verified_at = coalesce(verified_at, $2), updated_at = now() where id = $1`,
      [id, now(), actor],
    );
    await audit(actor, "approve", "question", id, { checksWarnings: checks.filter((c) => c.level === "warning").map((c) => c.code) }, sql);
  });
}

export async function setQuestionStatus(id: string, status: "rejected" | "archived" | "review", actor: string, note?: string): Promise<void> {
  const db = await getDb();
  await db.tx(async (sql) => {
    const q = await sql.one<QuestionRow>("select * from questions where id = $1 for update", [id]);
    if (!q) throw new ApiError(404, "not_found", "Question not found.");
    await sql.query("update questions set status = $2, review_notes = coalesce($3, review_notes), updated_at = now() where id = $1", [id, status, note ?? null]);
    await audit(actor, `set_${status}`, "question", id, { from: q.status, note }, sql);
  });
}

/**
 * Audited correction for a question that's already live. The published
 * snapshot is never edited. Instead the question is voided for everyone on
 * that day: it scores 0 for all players, is excluded from totals and the
 * daily maximum, and the reveal explains why. Then fix the bank copy (which
 * returns it to review) if it should be reused.
 */
export async function voidQuestion(challengeId: string, position: number, reason: string, actor: string): Promise<number> {
  if (!reason.trim()) throw new ApiError(400, "reason_required", "Give a reason players will see.");
  const db = await getDb();
  return db.tx(async (sql) => {
    const cq = await sql.one<{ voided: boolean; question_id: string }>(
      "select voided, question_id from challenge_questions where challenge_id = $1 and position = $2 for update",
      [challengeId, position],
    );
    if (!cq) throw new ApiError(404, "not_found", "Question not found in that challenge.");
    if (cq.voided) return 0;
    const at = now();
    await sql.query(
      "update challenge_questions set voided = true, voided_reason = $3, voided_at = $4, voided_by = $5 where challenge_id = $1 and position = $2",
      [challengeId, position, reason.trim().slice(0, 300), at, actor],
    );
    const attempts = await sql.query<{ id: string }>("select id from attempts where challenge_id = $1 for update", [challengeId]);
    for (const a of attempts) await recomputeAttempt(sql, a.id, at);
    await sql.query("update questions set status = 'review', review_notes = $2, updated_at = now() where id = $1 and status = 'approved'", [
      cq.question_id,
      `Voided on a live challenge: ${reason.trim()}`,
    ]);
    await audit(actor, "void", "challenge_question", `${challengeId}:${position}`, { reason, affectedAttempts: attempts.length, questionId: cq.question_id }, sql);
    return attempts.length;
  });
}
