import Link from "next/link";
import { notFound } from "next/navigation";
import { candidateAction, jobControlAction } from "@/app/admin/actions";
import { JobPoller } from "@/components/admin/JobPoller";
import { Badge, Panel } from "@/components/admin/ui";
import { getJob } from "@/lib/server/ai/pipeline";

export default async function JobPage(props: PageProps<"/admin/jobs/[id]">) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await getJob(id);
  if (!data) notFound();
  const { job, candidates } = data;
  const active = job.status === "queued" || job.status === "running";
  return (
    <div className="space-y-5">
      <Link href="/admin/generate" className="text-sm underline">‹ Generate</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-extrabold">Generation job</h1>
        <Badge>{job.status}</Badge>
        {active && <JobPoller jobId={job.id} />}
      </div>
      <Panel>
        <p className="text-sm">
          Target {job.target_count} · proposed {job.proposed_count} · <strong className="text-mint">accepted {job.accepted_count}</strong> · held {job.held_count} · rejected{" "}
          {job.rejected_count} · {job.api_calls} API calls · {job.web_searches} searches · {(Number(job.input_tokens) / 1000).toFixed(0)}k in /{" "}
          {(Number(job.output_tokens) / 1000).toFixed(0)}k out tokens · <strong>~${Number(job.estimated_cost_usd).toFixed(2)} estimated</strong>
        </p>
        {job.progress_note && <p className="mt-1 text-sm text-ink-soft">{job.progress_note}</p>}
        {job.error && <p className="mt-1 text-sm font-semibold text-coral">{job.error}</p>}
        <p className="mt-1 text-xs text-ink-soft">Instructions: {job.params.instructions || "(none)"} · categories: {job.params.categories.join(", ")}</p>
        <div className="mt-3 flex gap-2">
          {(active || job.status === "paused") && (
            <form action={jobControlAction}><input type="hidden" name="id" value={job.id} /><input type="hidden" name="op" value="cancel" /><button className="btn-soft min-h-9 px-3 py-1 text-sm">Cancel job</button></form>
          )}
          {(job.status === "paused" || job.status === "failed") && (
            <form action={jobControlAction}><input type="hidden" name="id" value={job.id} /><input type="hidden" name="op" value="resume" /><button className="btn-ink min-h-9 px-3 py-1 text-sm">Resume</button></form>
          )}
        </div>
        {active && <p className="mt-2 text-xs text-ink-soft">Keep this page open to process the job now. Otherwise the daily cron continues it.</p>}
      </Panel>
      <div className="space-y-3">
        {candidates.map((c) => {
          const p = c.proposal as { prompt?: string; answer?: number; unit?: string; category?: string; difficulty?: string; explanation?: string };
          const r = c.research;
          return (
            <Panel key={c.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{String(p.prompt ?? "(invalid proposal)")}</p>
                  <p className="text-sm text-ink-soft">
                    Proposed answer: <strong className="text-ink">{String(p.answer ?? "?")} {String(p.unit ?? "")}</strong> · {String(p.category ?? "")} · {String(p.difficulty ?? "")}
                  </p>
                  {r && (
                    <p className="mt-1 text-sm">
                      Research: <Badge tone={r.verdict === "supported" ? "approved" : "warning"}>{r.verdict}</Badge> value in source {r.value_in_source ?? "—"} {r.unit_in_source ?? ""}{" "}
                      {r.source_url && <a href={r.source_url} target="_blank" rel="noopener noreferrer nofollow" className="text-sky underline">{r.source_title || r.source_url}</a>}
                      {r.excerpt && <span className="mt-1 block border-l-4 border-line pl-2 text-ink-soft italic">“{r.excerpt}”</span>}
                    </p>
                  )}
                  {c.reasons.length > 0 && (
                    <ul className="mt-2 list-disc pl-5 text-sm">{c.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge>{c.status}</Badge>
                  {c.question_id && <Link className="text-sm underline" href={`/admin/questions/${c.question_id}`}>Review / edit</Link>}
                  {c.status !== "proposed" && (
                    <div className="flex flex-wrap justify-end gap-1">
                      {[["reverify", "Re-verify"], ["regenerate", "Regenerate"], ...(!c.question_id ? [["draft", "Edit as draft"]] : [])].map(([op, label]) => (
                        <form key={op} action={candidateAction}>
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="op" value={op} />
                          <button className="rounded-lg border border-line px-2 py-1 text-xs font-semibold">{label}</button>
                        </form>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Panel>
          );
        })}
        {candidates.length === 0 && <p className="text-ink-soft">No candidates yet.</p>}
      </div>
    </div>
  );
}
