"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CATEGORIES, DIFFICULTIES } from "@/lib/content-checks";
import { SCORING_TYPES } from "@/lib/scoring";
import { requireAdmin } from "@/lib/server/admin/auth";
import { approveQuestion, createManualQuestion, setQuestionStatus, updateQuestion, voidQuestion, type SaveInput } from "@/lib/server/admin/questions";
import { resolveNotification, swapQuestion, unscheduleDay } from "@/lib/server/admin/ops";
import { updateSettings } from "@/lib/server/admin/settings";
import { advanceJob, cancelJob, createJob, draftFromCandidate, regenerateCandidate, resumeJob, reverifyCandidate } from "@/lib/server/ai/pipeline";
import { fillSchedule, today } from "@/lib/server/challenges";
import { ApiError } from "@/lib/server/errors";
import { getDb } from "@/lib/db";
import { audit } from "@/lib/server/notify";
import { checkSource } from "@/lib/server/source-check";
import { addDays } from "@/lib/time";

/**
 * Admin server actions. Each one re-checks admin authorization on the server
 * (requireAdmin) — the admin UI being hidden is not a security boundary.
 */

export interface FormState {
  error?: string;
  message?: string;
}

function msg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof z.ZodError) return `Invalid input: ${e.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`;
  return e instanceof Error ? e.message : "Something went wrong.";
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => Number(str(f, k).replace(/,/g, ""));
const bool = (f: FormData, k: string) => f.get(k) === "on" || f.get(k) === "true";

const QuestionInput = z.object({
  prompt: z.string().min(10).max(300),
  answer: z.number().finite(),
  unit: z.string().max(40),
  category: z.enum(CATEGORIES),
  difficulty: z.enum(DIFFICULTIES),
  scoringType: z.enum(SCORING_TYPES),
  tolerance: z.number().finite().positive(),
  allowDecimal: z.boolean(),
  allowNegative: z.boolean(),
  explanation: z.string().max(600),
  sourceUrl: z.string().url().max(2000).nullable(),
  sourceTitle: z.string().max(300).nullable(),
  sourceExcerpt: z.string().max(2000).nullable(),
  referencePeriod: z.string().max(120).nullable(),
  subject: z.string().max(120),
});

function readQuestion(f: FormData): SaveInput {
  const n = (k: string) => str(f, k) || null;
  return QuestionInput.parse({
    prompt: str(f, "prompt"),
    answer: num(f, "answer"),
    unit: str(f, "unit"),
    category: str(f, "category"),
    difficulty: str(f, "difficulty"),
    scoringType: str(f, "scoringType"),
    tolerance: num(f, "tolerance"),
    allowDecimal: bool(f, "allowDecimal"),
    allowNegative: bool(f, "allowNegative"),
    explanation: str(f, "explanation"),
    sourceUrl: n("sourceUrl"),
    sourceTitle: n("sourceTitle"),
    sourceExcerpt: n("sourceExcerpt"),
    referencePeriod: n("referencePeriod"),
    subject: str(f, "subject"),
  });
}

export async function saveQuestionAction(_prev: FormState, f: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  let id = str(f, "id");
  try {
    const input = readQuestion(f);
    if (id) await updateQuestion(id, input, admin.actor);
    else id = await createManualQuestion(input, admin.actor);
  } catch (e) {
    return { error: msg(e) };
  }
  revalidatePath("/admin/questions");
  redirect(`/admin/questions/${id}?saved=1`);
}

export async function approveAction(_prev: FormState, f: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const id = str(f, "id");
  try {
    await approveQuestion(id, admin.actor, { confirmedSource: bool(f, "confirmedSource"), acknowledgeWarnings: bool(f, "acknowledgeWarnings") });
  } catch (e) {
    return { error: msg(e) };
  }
  revalidatePath(`/admin/questions/${id}`);
  return { message: "Approved." };
}

export async function statusAction(f: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = str(f, "id");
  const status = z.enum(["rejected", "archived", "review"]).parse(str(f, "status"));
  await setQuestionStatus(id, status, admin.actor, str(f, "note") || undefined);
  revalidatePath(`/admin/questions/${id}`);
}

export async function bulkApproveAction(_prev: FormState, f: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const ids = f.getAll("ids").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length) return { error: "Select at least one question." };
  if (!bool(f, "confirmedSource")) return { error: "Confirm you reviewed the sources for every selected question." };
  const failed: string[] = [];
  for (const id of ids.slice(0, 100)) {
    try {
      await approveQuestion(id, admin.actor, { confirmedSource: true, acknowledgeWarnings: bool(f, "acknowledgeWarnings") });
    } catch (e) {
      failed.push(msg(e));
    }
  }
  revalidatePath("/admin/questions");
  return failed.length
    ? { error: `${ids.length - failed.length} approved, ${failed.length} not approved. First problem: ${failed[0]}` }
    : { message: `${ids.length} approved.` };
}

export async function sourceCheckAction(f: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = str(f, "id");
  const db = await getDb();
  const q = await db.one<{ source_url: string | null; source_excerpt: string | null; answer: number; verification_notes: unknown[] }>(
    "select source_url, source_excerpt, answer, verification_notes from questions where id = $1",
    [id],
  );
  if (!q) return;
  const r = await checkSource(q.source_url, q.source_excerpt, q.answer);
  const notes = [...(Array.isArray(q.verification_notes) ? q.verification_notes : []), { level: r.status === "supported" ? "info" : "warning", message: `Source check (${r.checkedAt.slice(0, 16)}): ${r.detail}` }].slice(-12);
  await db.query(
    "update questions set verification_notes = $2, verified_at = case when $3 then $4::timestamptz else verified_at end, updated_at = now() where id = $1",
    [id, JSON.stringify(notes), r.status === "supported", new Date()],
  );
  await audit(admin.actor, "source_check", "question", id, { status: r.status });
  revalidatePath(`/admin/questions/${id}`);
}

export async function createJobAction(_prev: FormState, f: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  let id: string;
  try {
    const easy = num(f, "easy");
    const medium = num(f, "medium");
    const hard = num(f, "hard");
    id = await createJob(
      {
        quantity: num(f, "quantity"),
        categories: f.getAll("categories").map(String).filter((c) => (CATEGORIES as readonly string[]).includes(c)),
        difficulty: { easy: Math.max(0, easy || 0), medium: Math.max(0, medium || 0), hard: Math.max(0, hard || 0) },
        instructions: str(f, "instructions"),
      },
      admin.actor,
    );
  } catch (e) {
    return { error: msg(e) };
  }
  // Start working immediately after responding; the job page keeps it moving.
  after(async () => {
    await advanceJob(id, 50_000).catch(() => {});
  });
  redirect(`/admin/jobs/${id}`);
}

export async function jobControlAction(f: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = str(f, "id");
  const op = str(f, "op");
  if (op === "cancel") await cancelJob(id, admin.actor);
  if (op === "resume") await resumeJob(id, admin.actor);
  revalidatePath(`/admin/jobs/${id}`);
}

export async function candidateAction(f: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = str(f, "id");
  const op = str(f, "op");
  if (op === "reverify") {
    const jobId = await reverifyCandidate(id, admin.actor);
    redirect(`/admin/jobs/${jobId}`);
  }
  if (op === "regenerate") {
    const jobId = await regenerateCandidate(id, admin.actor);
    redirect(`/admin/jobs/${jobId}`);
  }
  if (op === "draft") {
    const qid = await draftFromCandidate(id, admin.actor);
    redirect(`/admin/questions/${qid}`);
  }
}

export async function fillScheduleAction(_prev: FormState, f: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const days = Math.max(1, Math.min(60, num(f, "days") || 14));
  const from = str(f, "from") || addDays(today(), 1);
  if (from < today()) return { error: "Start date can't be in the past." };
  const r = await fillSchedule(from, days, admin.actor, "manual");
  revalidatePath("/admin/schedule");
  return r.missing.length
    ? { error: `Scheduled ${r.created.length} day(s). Not enough balanced approved questions for ${r.missing.length} day(s) starting ${r.missing[0]}.` }
    : { message: `Scheduled ${r.created.length} day(s).` };
}

export async function scheduleOpAction(f: FormData): Promise<void> {
  const admin = await requireAdmin();
  const op = str(f, "op");
  const challengeId = str(f, "challengeId");
  if (op === "unschedule") await unscheduleDay(challengeId, admin.actor);
  if (op === "swap") await swapQuestion(challengeId, num(f, "position"), str(f, "questionId"), admin.actor);
  revalidatePath("/admin/schedule");
}

export async function voidAction(_prev: FormState, f: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  if (!bool(f, "confirm")) return { error: "Tick the confirmation box." };
  try {
    const n = await voidQuestion(str(f, "challengeId"), num(f, "position"), str(f, "reason"), admin.actor);
    revalidatePath("/admin/schedule");
    return { message: `Voided. ${n} player attempt(s) were recalculated.` };
  } catch (e) {
    return { error: msg(e) };
  }
}

const SettingsInput = z.object({
  autoGenerate: z.boolean(),
  autoApprove: z.boolean(),
  autoSchedule: z.boolean(),
  inventoryThresholdDays: z.number().int().min(1).max(180),
  scheduleAheadDays: z.number().int().min(1).max(60),
  maxQuestionsPerJob: z.number().int().min(1).max(100),
  monthlyQuestionLimit: z.number().int().min(0).max(5000),
  monthlyCostLimitUsd: z.number().min(0).max(10000),
  maxApiCallsPerJob: z.number().int().min(1).max(1000),
  maxRetriesPerCandidate: z.number().int().min(0).max(5),
  maxOutputTokensPerCall: z.number().int().min(1000).max(64000),
});

export async function settingsAction(_prev: FormState, f: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  try {
    const v = SettingsInput.parse({
      autoGenerate: bool(f, "autoGenerate"),
      autoApprove: bool(f, "autoApprove"),
      autoSchedule: bool(f, "autoSchedule"),
      inventoryThresholdDays: num(f, "inventoryThresholdDays"),
      scheduleAheadDays: num(f, "scheduleAheadDays"),
      maxQuestionsPerJob: num(f, "maxQuestionsPerJob"),
      monthlyQuestionLimit: num(f, "monthlyQuestionLimit"),
      monthlyCostLimitUsd: num(f, "monthlyCostLimitUsd"),
      maxApiCallsPerJob: num(f, "maxApiCallsPerJob"),
      maxRetriesPerCandidate: num(f, "maxRetriesPerCandidate"),
      maxOutputTokensPerCall: num(f, "maxOutputTokensPerCall"),
    });
    if (v.autoApprove && !bool(f, "autoApproveAck")) return { error: "To enable auto-approve, confirm that you understand automated checks don't guarantee correctness." };
    await updateSettings(v, admin.actor);
  } catch (e) {
    return { error: msg(e) };
  }
  revalidatePath("/admin/settings");
  return { message: "Settings saved." };
}

export async function resolveNotificationAction(f: FormData): Promise<void> {
  const admin = await requireAdmin();
  await resolveNotification(str(f, "id"), admin.actor);
  revalidatePath("/admin");
}
