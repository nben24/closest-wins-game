import Link from "next/link";
import { notFound } from "next/navigation";
import { approveAction, sourceCheckAction, statusAction } from "@/app/admin/actions";
import { ActionForm } from "@/components/admin/ActionForm";
import { QuestionForm } from "@/components/admin/QuestionForm";
import { Badge, Panel } from "@/components/admin/ui";
import { getDb } from "@/lib/db";
import { findDuplicates, getQuestion } from "@/lib/server/admin/questions";

export default async function QuestionPage(props: PageProps<"/admin/questions/[id]">) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const q = await getQuestion(id);
  if (!q) notFound();
  const sp = await props.searchParams;
  const db = await getDb();
  const used = await db.query<{ challenge_date: string; status: string; position: number }>(
    "select dc.challenge_date, dc.status, cq.position from challenge_questions cq join daily_challenges dc on dc.id = cq.challenge_id where cq.question_id = $1",
    [id],
  );
  const dups = await findDuplicates(q.prompt, q.subject_key, q.id);
  const notes = Array.isArray(q.verification_notes) ? q.verification_notes : [];
  const live = used.some((u) => u.status === "published");

  return (
    <div className="space-y-5">
      <Link href="/admin/questions" className="text-sm underline">‹ Questions</Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl font-extrabold">Question</h1>
        <Badge>{q.status}</Badge>
        <Badge>{q.verification_status}</Badge>
        {q.is_demo ? <Badge tone="demo">demo · not verified</Badge> : <Badge tone="draft">{q.provenance}</Badge>}
        {sp.saved && <span className="text-sm font-semibold text-mint">Saved.</span>}
      </div>
      {live && (
        <p className="rounded-xl bg-sun-soft p-3 text-sm">
          This question was used in a published challenge ({used.filter((u) => u.status === "published").map((u) => u.challenge_date).join(", ")}). Edits here never change
          what players saw or how they were scored. To correct a live mistake, <Link className="underline" href="/admin/schedule">void it on the Schedule page</Link> — it then
          counts as 0 for everyone and is excluded from totals.
        </p>
      )}

      {notes.length > 0 && (
        <Panel title="Verification notes">
          <ul className="space-y-1 text-sm">
            {notes.map((n, i) => (
              <li key={i}>{n.level === "warning" ? "⚠" : n.level === "error" ? "✖" : "ℹ"} {n.message}</li>
            ))}
          </ul>
        </Panel>
      )}
      {dups.length > 0 && (
        <Panel title="Possible duplicates">
          <ul className="space-y-1 text-sm">
            {dups.map((d) => (
              <li key={d.id}><Link className="underline" href={`/admin/questions/${d.id}`}>{d.prompt}</Link> <Badge>{d.status}</Badge> <span className="text-ink-soft">similarity {d.score.toFixed(2)}</span></li>
            ))}
          </ul>
        </Panel>
      )}

      <QuestionForm
        readOnly={q.is_demo}
        initial={{
          id: q.id, prompt: q.prompt, answer: String(q.answer), unit: q.unit, category: q.category, difficulty: q.difficulty,
          scoringType: q.scoring_type, tolerance: String(q.tolerance), allowDecimal: q.allow_decimal, allowNegative: q.allow_negative,
          explanation: q.explanation, sourceUrl: q.source_url ?? "", sourceTitle: q.source_title ?? "", sourceExcerpt: q.source_excerpt ?? "",
          referencePeriod: q.reference_period ?? "", subject: q.subject_key,
        }}
      />

      {!q.is_demo && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Review">
            {q.source_url && (
              <p className="mb-2 text-sm">
                Source: <a href={q.source_url} target="_blank" rel="noopener noreferrer nofollow" className="text-sky underline">{q.source_title || q.source_url}</a>
              </p>
            )}
            <form action={sourceCheckAction} className="mb-3">
              <input type="hidden" name="id" value={q.id} />
              <button className="btn-soft min-h-9 px-3 py-1 text-sm">Run independent source check</button>
              <span className="ml-2 text-xs text-ink-soft">Fetches the page and looks for the excerpt and the number.</span>
            </form>
            {q.status !== "approved" ? (
              <ActionForm action={approveAction} submitLabel="Approve" submitClass="btn-primary">
                <input type="hidden" name="id" value={q.id} />
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmedSource" /> I opened the source; it supports this exact wording, number, unit and period.</label>
                <label className="mt-1 flex items-start gap-2 text-sm"><input type="checkbox" name="acknowledgeWarnings" /> I reviewed the warnings.</label>
              </ActionForm>
            ) : (
              <p className="text-sm text-mint">Approved {q.approved_at?.toISOString().slice(0, 10)} by {q.approved_by}.</p>
            )}
          </Panel>
          <Panel title="Status">
            <div className="flex flex-wrap gap-2">
              {(["review", "rejected", "archived"] as const).filter((s) => s !== q.status).map((s) => (
                <form key={s} action={statusAction}>
                  <input type="hidden" name="id" value={q.id} />
                  <input type="hidden" name="status" value={s} />
                  <button className="btn-soft min-h-9 px-3 py-1 text-sm">{s === "review" ? "Back to review" : s === "rejected" ? "Reject" : "Archive"}</button>
                </form>
              ))}
            </div>
            {q.review_notes && <p className="mt-2 text-sm text-ink-soft">Note: {q.review_notes}</p>}
            {used.length > 0 && <p className="mt-2 text-sm text-ink-soft">Scheduled/used on: {used.map((u) => `${u.challenge_date} (Q${u.position}, ${u.status})`).join(", ")}</p>}
          </Panel>
        </div>
      )}
    </div>
  );
}
