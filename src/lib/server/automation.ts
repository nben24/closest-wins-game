import "server-only";
import { QUESTIONS_PER_DAY } from "@/config/game";
import { CATEGORIES } from "@/lib/content-checks";
import { addDays } from "@/lib/time";
import { getSettings } from "@/lib/server/admin/settings";
import { advanceJob, createJob, monthlyUsage, runnableJobIds } from "@/lib/server/ai/pipeline";
import { getAiProvider } from "@/lib/server/ai/provider";
import { fillSchedule, getPlayableChallenge, inventoryStatus, today } from "@/lib/server/challenges";
import { getDb } from "@/lib/db";
import { notifyAdmin } from "@/lib/server/notify";
import { pruneRateLimits } from "@/lib/server/ratelimit";

/**
 * Daily maintenance (Vercel Cron, once a day). Everything here is opt-in via
 * admin settings except publishing today's already-approved challenge and
 * sending inventory warnings. No step spends money unless auto-generation is
 * enabled AND an API key is configured AND monthly limits allow it.
 */
export async function runDailyMaintenance(budgetMs = 240_000): Promise<Record<string, unknown>> {
  const started = Date.now();
  const log: Record<string, unknown> = {};
  const s = await getSettings();
  const t = today();

  const ch = await getPlayableChallenge(t);
  log.todayPublished = Boolean(ch);

  if (s.autoSchedule) {
    const r = await fillSchedule(addDays(t, 1), s.scheduleAheadDays, "system", "auto");
    log.scheduled = r.created;
    if (r.missing.length) {
      await notifyAdmin("schedule_gap", "warning", `Auto-schedule couldn't fill ${r.missing.length} day(s) starting ${r.missing[0]}: not enough balanced approved questions.`, `gap:${r.missing[0]}`);
    }
  }

  const inv = await inventoryStatus();
  log.inventoryDays = inv.inventoryDays;
  if (inv.inventoryDays < s.inventoryThresholdDays) {
    await notifyAdmin(
      "inventory_low",
      inv.inventoryDays < 3 ? "error" : "warning",
      `Approved inventory covers about ${inv.inventoryDays} day(s), below your ${s.inventoryThresholdDays}-day threshold. ${inv.reviewQueue} question(s) are waiting for review.`,
      `inventory_low:${t}`,
    );
    if (s.autoGenerate) {
      const db = await getDb();
      const active = await db.one<{ n: number }>("select count(*)::int as n from generation_jobs where status in ('queued','running','paused')");
      const m = await monthlyUsage();
      if (!getAiProvider()) {
        await notifyAdmin("ai_missing", "warning", "Automatic generation is on, but ANTHROPIC_API_KEY is not configured.", "ai_missing");
      } else if (active!.n > 0) {
        log.autoGenerate = "skipped: a job is already active";
      } else if (m.proposals >= s.monthlyQuestionLimit || m.costUsd >= s.monthlyCostLimitUsd) {
        await notifyAdmin("budget", "warning", "Automatic generation skipped: monthly limit reached.", `budget-month:${t.slice(0, 7)}`);
      } else {
        const need = (s.inventoryThresholdDays - inv.inventoryDays) * QUESTIONS_PER_DAY;
        const quantity = Math.max(5, Math.min(s.maxQuestionsPerJob, need));
        try {
          log.autoJob = await createJob(
            { quantity, categories: [...CATEGORIES], difficulty: { easy: 40, medium: 45, hard: 15 }, instructions: "" },
            "system:auto-replenish",
            "auto",
          );
        } catch (e) {
          await notifyAdmin("job_failed", "error", `Automatic generation could not start: ${e instanceof Error ? e.message : "error"}`, `autojob:${t}`);
        }
      }
    }
  }

  const advanced: string[] = [];
  for (const id of await runnableJobIds()) {
    const remaining = budgetMs - (Date.now() - started);
    if (remaining < 60_000) break;
    await advanceJob(id, remaining - 45_000);
    advanced.push(id);
  }
  log.advancedJobs = advanced;
  await pruneRateLimits();
  return log;
}

/** Lighter worker: just advance queued/running generation jobs. */
export async function runJobWorker(budgetMs = 240_000): Promise<string[]> {
  const started = Date.now();
  const advanced: string[] = [];
  for (const id of await runnableJobIds()) {
    const remaining = budgetMs - (Date.now() - started);
    if (remaining < 60_000) break;
    await advanceJob(id, remaining - 45_000);
    advanced.push(id);
  }
  return advanced;
}
