import "server-only";
import { getDb } from "@/lib/db";

export interface AppSettings {
  autoGenerate: boolean;
  autoApprove: boolean;
  autoSchedule: boolean;
  inventoryThresholdDays: number;
  scheduleAheadDays: number;
  maxQuestionsPerJob: number;
  monthlyQuestionLimit: number;
  monthlyCostLimitUsd: number;
  maxApiCallsPerJob: number;
  maxRetriesPerCandidate: number;
  maxOutputTokensPerCall: number;
  updatedAt: Date;
  updatedBy: string | null;
}

export async function getSettings(): Promise<AppSettings> {
  const db = await getDb();
  const r = await db.one<Record<string, unknown>>("select * from app_settings where id");
  return {
    autoGenerate: r!.auto_generate as boolean,
    autoApprove: r!.auto_approve as boolean,
    autoSchedule: r!.auto_schedule as boolean,
    inventoryThresholdDays: r!.inventory_threshold_days as number,
    scheduleAheadDays: r!.schedule_ahead_days as number,
    maxQuestionsPerJob: r!.max_questions_per_job as number,
    monthlyQuestionLimit: r!.monthly_question_limit as number,
    monthlyCostLimitUsd: Number(r!.monthly_cost_limit_usd),
    maxApiCallsPerJob: r!.max_api_calls_per_job as number,
    maxRetriesPerCandidate: r!.max_retries_per_candidate as number,
    maxOutputTokensPerCall: r!.max_output_tokens_per_call as number,
    updatedAt: r!.updated_at as Date,
    updatedBy: (r!.updated_by as string) ?? null,
  };
}

export async function updateSettings(patch: Partial<Omit<AppSettings, "updatedAt" | "updatedBy">>, actor: string): Promise<void> {
  const map: Record<string, string> = {
    autoGenerate: "auto_generate",
    autoApprove: "auto_approve",
    autoSchedule: "auto_schedule",
    inventoryThresholdDays: "inventory_threshold_days",
    scheduleAheadDays: "schedule_ahead_days",
    maxQuestionsPerJob: "max_questions_per_job",
    monthlyQuestionLimit: "monthly_question_limit",
    monthlyCostLimitUsd: "monthly_cost_limit_usd",
    maxApiCallsPerJob: "max_api_calls_per_job",
    maxRetriesPerCandidate: "max_retries_per_candidate",
    maxOutputTokensPerCall: "max_output_tokens_per_call",
  };
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in map) || v === undefined) continue;
    vals.push(v);
    sets.push(`${map[k]} = $${vals.length}`);
  }
  if (!sets.length) return;
  vals.push(actor);
  const db = await getDb();
  await db.tx(async (sql) => {
    await sql.query(`update app_settings set ${sets.join(", ")}, updated_at = now(), updated_by = $${vals.length} where id`, vals);
    await sql.query("insert into audit_log (actor, action, entity_type, details) values ($1, 'update_settings', 'app_settings', $2)", [
      actor,
      JSON.stringify(patch),
    ]);
  });
}
