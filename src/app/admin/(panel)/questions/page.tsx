import Link from "next/link";
import { bulkApproveAction } from "@/app/admin/actions";
import { ActionForm } from "@/components/admin/ActionForm";
import { Badge } from "@/components/admin/ui";
import { CATEGORIES, DIFFICULTIES } from "@/lib/content-checks";
import { formatValue } from "@/lib/format";
import { listQuestions } from "@/lib/server/admin/questions";

export default async function QuestionsPage(props: PageProps<"/admin/questions">) {
  const sp = await props.searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const page = Math.max(0, Number(one("page") ?? 0) || 0);
  const filter = { q: one("q"), status: one("status"), category: one("category"), difficulty: one("difficulty"), provenance: one("provenance"), limit: 50, offset: page * 50 };
  const { rows, total } = await listQuestions(filter);
  const sel = "rounded-lg border border-line bg-white px-2 py-1.5";
  const qs = (p: number) => new URLSearchParams(Object.entries({ ...filter, page: String(p), limit: undefined, offset: undefined }).filter(([, v]) => v !== undefined) as [string, string][]).toString();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-extrabold">Questions <span className="text-lg text-ink-soft">({total})</span></h1>
        <Link href="/admin/questions/new" className="btn-primary min-h-10 text-base">Add manually</Link>
      </div>
      <form className="flex flex-wrap gap-2 text-sm" role="search">
        <input name="q" defaultValue={filter.q} placeholder="Search prompts…" className={`${sel} min-w-56 flex-1`} />
        <select name="status" defaultValue={filter.status ?? ""} className={sel}>
          <option value="">Any status</option>
          {["draft", "review", "approved", "rejected", "archived"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <select name="category" defaultValue={filter.category ?? ""} className={sel}>
          <option value="">Any category</option>
          {CATEGORIES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select name="difficulty" defaultValue={filter.difficulty ?? ""} className={sel}>
          <option value="">Any difficulty</option>
          {DIFFICULTIES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select name="provenance" defaultValue={filter.provenance ?? ""} className={sel}>
          <option value="">Any origin</option>
          {["ai", "manual", "demo"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <button className="btn-soft min-h-9 px-3 py-1 text-sm">Filter</button>
      </form>

      <ActionForm action={bulkApproveAction} submitLabel="Approve selected" submitClass="btn-primary">
        <div className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full text-sm">
            <thead className="bg-paper text-left text-ink-soft">
              <tr><th className="p-2"><span className="sr-only">Select</span></th><th className="p-2">Prompt</th><th className="p-2">Answer</th><th className="p-2">Category</th><th className="p-2">Status</th><th className="p-2">Verification</th><th className="p-2">Origin</th><th className="p-2">Used</th></tr>
            </thead>
            <tbody>
              {rows.map((q) => (
                <tr key={q.id} className="border-t border-line align-top">
                  <td className="p-2">{q.status === "review" && !q.is_demo && <input type="checkbox" name="ids" value={q.id} aria-label={`Select ${q.prompt}`} />}</td>
                  <td className="max-w-md p-2"><Link className="font-semibold hover:underline" href={`/admin/questions/${q.id}`}>{q.prompt}</Link></td>
                  <td className="p-2 whitespace-nowrap tabular-nums">{formatValue(q.answer, q.scoring_type)} {q.unit}</td>
                  <td className="p-2">{q.category}<br /><span className="text-ink-soft">{q.difficulty}</span></td>
                  <td className="p-2"><Badge>{q.status}</Badge></td>
                  <td className="p-2"><Badge>{q.verification_status}</Badge></td>
                  <td className="p-2">{q.is_demo ? <Badge tone="demo">demo</Badge> : q.provenance}</td>
                  <td className="p-2 whitespace-nowrap text-ink-soft">{q.used_on ?? "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-ink-soft">No questions match.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="mt-3 space-y-1 text-sm">
          <label className="flex items-start gap-2"><input type="checkbox" name="confirmedSource" /> I opened the source for each selected question and it supports the exact wording, number, unit and period.</label>
          <label className="flex items-start gap-2"><input type="checkbox" name="acknowledgeWarnings" /> I reviewed each question&apos;s warnings.</label>
          <p className="text-ink-soft">Automated checks reduce errors but don&apos;t guarantee correctness. Questions with blocking problems are skipped.</p>
        </div>
      </ActionForm>
      <div className="flex gap-3 text-sm">
        {page > 0 && <Link className="underline" href={`?${qs(page - 1)}`}>‹ Previous</Link>}
        {(page + 1) * 50 < total && <Link className="underline" href={`?${qs(page + 1)}`}>Next ›</Link>}
      </div>
    </div>
  );
}
