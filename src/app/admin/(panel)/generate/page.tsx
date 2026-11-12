import Link from "next/link";
import { createJobAction } from "@/app/admin/actions";
import { ActionForm } from "@/components/admin/ActionForm";
import { Badge, inputCls, Panel } from "@/components/admin/ui";
import { categoryLabel } from "@/lib/labels";
import { CATEGORIES } from "@/lib/content-checks";
import { getSettings } from "@/lib/server/admin/settings";
import { listJobs, monthlyUsage } from "@/lib/server/ai/pipeline";
import { aiStatus } from "@/lib/server/ai/provider";

export default async function GeneratePage() {
  const [settings, jobs, usage] = await Promise.all([getSettings(), listJobs(), monthlyUsage()]);
  const ai = aiStatus();
  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-extrabold">Generate more</h1>
      {!ai.configured ? (
        <Panel>
          <p className="font-bold text-coral">AI generation is unavailable.</p>
          <p className="mt-1 text-sm">
            Set <code>ANTHROPIC_API_KEY</code> (and optionally <code>ANTHROPIC_MODEL</code>) in the server environment and redeploy. Until then you can{" "}
            <Link className="underline" href="/admin/questions/new">add questions manually</Link>.
          </p>
        </Panel>
      ) : (
        <Panel title="New batch">
          <ActionForm action={createJobAction} submitLabel="Generate more" submitClass="btn-primary">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-bold">
                How many approved-quality questions (max {settings.maxQuestionsPerJob})
                <input name="quantity" type="number" min={1} max={settings.maxQuestionsPerJob} defaultValue={Math.min(10, settings.maxQuestionsPerJob)} className={inputCls} />
              </label>
              <fieldset className="text-sm font-bold">
                Difficulty mix (%)
                <div className="mt-1 grid grid-cols-3 gap-2">
                  {[["easy", 40], ["medium", 45], ["hard", 15]].map(([k, d]) => (
                    <label key={k} className="text-xs font-semibold">{k}<input name={String(k)} type="number" min={0} max={100} defaultValue={d} className={inputCls} /></label>
                  ))}
                </div>
              </fieldset>
            </div>
            <fieldset className="mt-4">
              <legend className="text-sm font-bold">Categories (none = all)</legend>
              <div className="mt-1 flex flex-wrap gap-3 text-sm">
                {CATEGORIES.map((c) => (
                  <label key={c} className="flex items-center gap-1.5"><input type="checkbox" name="categories" value={c} /> {categoryLabel(c)}</label>
                ))}
              </div>
            </fieldset>
            <label className="mt-4 block text-sm font-bold">
              Instructions (optional)
              <textarea name="instructions" rows={2} maxLength={1000} className={inputCls} placeholder='e.g. "Generate 30 approachable food questions."' />
            </label>
            <p className="mt-2 text-sm text-ink-soft">
              Runs in the background in small batches: propose → research with web search → independent source check → quality, safety and duplicate checks.
              Results go to the review queue{settings.autoApprove ? " (auto-approve is ON for candidates that pass every check)" : ""}. Proposals are capped at
              2× the requested number; each job is limited to {settings.maxApiCallsPerJob} API calls.
            </p>
          </ActionForm>
        </Panel>
      )}
      <p className="text-sm text-ink-soft">
        Model: {ai.model} · This month (estimated): ${usage.costUsd.toFixed(2)} of ${settings.monthlyCostLimitUsd} limit · {usage.calls} calls ·{" "}
        {usage.proposals} of {settings.monthlyQuestionLimit} proposals. Costs are estimates from list prices, not your invoice.
      </p>
      <Panel title="Jobs">
        <table className="w-full text-sm">
          <thead className="text-left text-ink-soft"><tr><th className="py-1">Created</th><th>Status</th><th>Target</th><th>Accepted</th><th>Held</th><th>Rejected</th><th>Calls</th><th>Est. cost</th><th></th></tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className="border-t border-line">
                <td className="py-1.5">{j.created_at.toISOString().slice(0, 16).replace("T", " ")} {j.trigger === "auto" && <Badge tone="draft">auto</Badge>}</td>
                <td><Badge>{j.status}</Badge></td>
                <td className="tabular-nums">{j.target_count}</td>
                <td className="tabular-nums">{j.accepted_count}</td>
                <td className="tabular-nums">{j.held_count}</td>
                <td className="tabular-nums">{j.rejected_count}</td>
                <td className="tabular-nums">{j.api_calls}</td>
                <td className="tabular-nums">${Number(j.estimated_cost_usd).toFixed(2)}</td>
                <td><Link className="underline" href={`/admin/jobs/${j.id}`}>Open</Link></td>
              </tr>
            ))}
            {jobs.length === 0 && <tr><td colSpan={9} className="py-4 text-center text-ink-soft">No jobs yet.</td></tr>}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
