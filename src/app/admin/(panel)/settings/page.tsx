import { settingsAction } from "@/app/admin/actions";
import { ActionForm } from "@/components/admin/ActionForm";
import { inputCls, Panel } from "@/components/admin/ui";
import { getSettings } from "@/lib/server/admin/settings";

export default async function SettingsPage() {
  const s = await getSettings();
  const num = (name: string, label: string, value: number, hint: string, step = "1") => (
    <label className="block text-sm font-bold">
      {label}
      <input name={name} type="number" step={step} defaultValue={value} className={inputCls} />
      <span className="mt-1 block text-xs font-normal text-ink-soft">{hint}</span>
    </label>
  );
  const toggle = (name: string, label: string, value: boolean, hint: string) => (
    <label className="flex items-start gap-3 rounded-xl border border-line p-3">
      <input type="checkbox" name={name} defaultChecked={value} className="mt-1 h-5 w-5" />
      <span><span className="font-bold">{label}</span><span className="block text-sm text-ink-soft">{hint}</span></span>
    </label>
  );
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="font-display text-3xl font-extrabold">Automation & limits</h1>
      <p className="rounded-xl bg-sun-soft p-3 text-sm">
        <strong>Automated checks reduce errors but do not guarantee correctness.</strong> Auto-approval publishes AI-researched facts without a human
        reading them. Keep it off until you trust the pipeline on your own spot checks.
      </p>
      <ActionForm action={settingsAction} submitLabel="Save settings">
        <div className="space-y-4">
          <Panel title="Automation (all off by default)">
            <div className="space-y-2">
              {toggle("autoGenerate", "Automatic generation", s.autoGenerate, "When approved inventory falls below the threshold, the daily job starts a generation batch (within the limits below).")}
              {toggle("autoApprove", "Automatic approval", s.autoApprove, "Candidates that pass every automated check — including the independent source check — are approved without review. Held candidates always need you.")}
              <label className="ml-8 flex items-start gap-2 text-sm"><input type="checkbox" name="autoApproveAck" defaultChecked={s.autoApprove} /> I understand automated checks don&apos;t guarantee correctness.</label>
              {toggle("autoSchedule", "Automatic scheduling", s.autoSchedule, "The daily job fills empty future days from the approved reserve. (Today is always filled from the reserve if empty.)")}
            </div>
          </Panel>
          <Panel title="Inventory">
            <div className="grid gap-3 sm:grid-cols-2">
              {num("inventoryThresholdDays", "Low-inventory threshold (days)", s.inventoryThresholdDays, "Warn (and auto-generate, if on) below this many days of approved questions.")}
              {num("scheduleAheadDays", "Schedule ahead (days)", s.scheduleAheadDays, "How far ahead automatic scheduling fills.")}
            </div>
          </Panel>
          <Panel title="Cost controls">
            <div className="grid gap-3 sm:grid-cols-2">
              {num("maxQuestionsPerJob", "Max questions per job", s.maxQuestionsPerJob, "Hard cap 100. Proposals are capped at 2× this.")}
              {num("maxApiCallsPerJob", "Max API calls per job", s.maxApiCallsPerJob, "A job pauses when it reaches this.")}
              {num("monthlyQuestionLimit", "Monthly proposal limit", s.monthlyQuestionLimit, "Candidates generated per calendar month (UTC).")}
              {num("monthlyCostLimitUsd", "Monthly estimated cost limit (USD)", s.monthlyCostLimitUsd, "Estimated from list prices; jobs pause when reached. With Haiku, a full month of fresh questions is about $2–4.", "0.01")}
              {num("maxRetriesPerCandidate", "Retries per candidate", s.maxRetriesPerCandidate, "Research retries after a transient failure.")}
              {num("maxOutputTokensPerCall", "Max output tokens per call", s.maxOutputTokensPerCall, "Upper bound for each model response.")}
            </div>
          </Panel>
        </div>
      </ActionForm>
      <p className="text-xs text-ink-soft">Last changed {s.updatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC{s.updatedBy ? ` by ${s.updatedBy}` : ""}.</p>
    </div>
  );
}
