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
              {toggle("autoApprove", "Automatic approval", s.autoApprove, "Questions that pass the checks below are approved without review. Anything that fails is set aside in the review queue (you can ignore it).")}
              <label className="ml-8 flex items-start gap-2 text-sm"><input type="checkbox" name="autoApproveAck" defaultChecked={s.autoApprove} /> I understand automated checks don&apos;t guarantee correctness.</label>
              <fieldset className="ml-8 space-y-2 rounded-xl border border-line p-3">
                <legend className="px-1 text-sm font-bold">How strict should automatic approval be?</legend>
                <label className="flex items-start gap-2 text-sm">
                  <input type="radio" name="approvalMode" value="relaxed" defaultChecked={s.approvalMode === "relaxed"} className="mt-1" />
                  <span><strong>Relaxed (recommended for hands-off):</strong> approve when the AI&apos;s research found a source that supports the answer <em>and</em> a separate AI double-check, which never sees the answer, lands within the question&apos;s tolerance. Costs about $0.001 extra per question.</span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input type="radio" name="approvalMode" value="strict" defaultChecked={s.approvalMode === "strict"} className="mt-1" />
                  <span><strong>Strict:</strong> approve only when the app opens the source page itself and finds the exact number. Safer, but many good questions get held for review.</span>
                </label>
              </fieldset>
              {toggle("autoSchedule", "Automatic scheduling", s.autoSchedule, "The daily job fills empty future days from the approved reserve. (Today is always filled from the reserve if empty.)")}
            </div>
          </Panel>
          <Panel title="Inventory">
            <div className="grid gap-3 sm:grid-cols-2">
              {num("inventoryThresholdDays", "Low-inventory threshold (days)", s.inventoryThresholdDays, "Warn (and auto-generate, if on) below this many days of approved questions.")}
              {num("scheduleAheadDays", "Keep this many days scheduled ahead", s.scheduleAheadDays, "Automatic scheduling tops up to this many future days every night.")}
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
