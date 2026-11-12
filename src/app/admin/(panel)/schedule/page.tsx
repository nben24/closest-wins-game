import { fillScheduleAction, scheduleOpAction, voidAction } from "@/app/admin/actions";
import { ActionForm } from "@/components/admin/ActionForm";
import { Badge, inputCls, Panel } from "@/components/admin/ui";
import { formatValue } from "@/lib/format";
import { addDays, formatGameDate } from "@/lib/time";
import { listChallenges } from "@/lib/server/admin/ops";
import { eligiblePool, inventoryStatus, today } from "@/lib/server/challenges";
import { getDb } from "@/lib/db";
import type { ScoringType } from "@/lib/scoring";

export default async function SchedulePage() {
  const t = today();
  const db = await getDb();
  const [past, upcoming, inv, pool] = await Promise.all([listChallenges(addDays(t, -7), 7), listChallenges(t, 35), inventoryStatus(), eligiblePool(db)]);
  const types = new Map(
    (await db.query<{ id: string; scoring_type: ScoringType }>("select id, scoring_type from questions")).map((r) => [r.id, r.scoring_type]),
  );
  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-extrabold">Schedule</h1>
      <p className="text-sm text-ink-soft">
        Days are America/New_York. A day is published (snapshot locked, immutable) when its first player arrives or when the daily cron runs.
        Reserve: {inv.unscheduledApproved} approved unused questions (~{Math.floor(inv.unscheduledApproved / 5)} days).
      </p>
      <Panel title="Auto-fill">
        <ActionForm action={fillScheduleAction} submitLabel="Fill empty days">
          <div className="flex flex-wrap gap-3">
            <label className="text-sm font-bold">From<input type="date" name="from" defaultValue={addDays(t, 1)} min={t} className={inputCls} /></label>
            <label className="text-sm font-bold">Days<input type="number" name="days" defaultValue={14} min={1} max={60} className={inputCls} /></label>
          </div>
          <p className="mt-2 text-sm text-ink-soft">Picks 5 approved questions per day: different categories, at most one hard, no near-duplicate subjects within ±30 days, gentle order.</p>
        </ActionForm>
      </Panel>

      <h2 className="font-display text-xl font-extrabold">Upcoming</h2>
      {upcoming.length === 0 && <p className="text-ink-soft">Nothing scheduled.</p>}
      {upcoming.map((c) => (
        <Panel
          key={c.id}
          title={`#${c.number} · ${formatGameDate(c.date, { weekday: "short", month: "short", day: "numeric" })}`}
          actions={
            <span className="flex items-center gap-2">
              <Badge>{c.status}</Badge> {c.isDemo && <Badge tone="demo">demo</Badge>} <span className="text-xs text-ink-soft">{c.source} · {c.attempts} started · {c.completed} done</span>
              {c.status === "scheduled" && c.date > t && (
                <form action={scheduleOpAction}><input type="hidden" name="op" value="unschedule" /><input type="hidden" name="challengeId" value={c.id} /><button className="rounded-lg border border-line px-2 py-1 text-xs font-semibold">Unschedule</button></form>
              )}
            </span>
          }
        >
          <ol className="space-y-2 text-sm">
            {c.questions.map((q) => (
              <li key={q.position} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 first:border-0 first:pt-0">
                <span className="min-w-0 flex-1">
                  <strong>Q{q.position}.</strong> {q.prompt} <span className="text-ink-soft">→ {formatValue(q.answer, types.get(q.questionId) ?? "ratio")} {q.unit} · {q.category} · {q.difficulty}</span>
                  {q.status !== "approved" && c.status === "scheduled" && <span className="ml-1"><Badge tone="warning">{`now ${q.status} — will be replaced at publish`}</Badge></span>}
                  {q.voided && <span className="ml-1"><Badge tone="rejected">voided</Badge></span>}
                </span>
                {c.status === "scheduled" && pool.length > 0 && (
                  <form action={scheduleOpAction} className="flex gap-1">
                    <input type="hidden" name="op" value="swap" /><input type="hidden" name="challengeId" value={c.id} /><input type="hidden" name="position" value={q.position} />
                    <select name="questionId" className="max-w-56 rounded-lg border border-line px-1 py-1 text-xs" aria-label={`Replacement for Q${q.position}`}>
                      {pool.slice(0, 200).map((p) => <option key={p.id} value={p.id}>[{p.difficulty}/{p.category}] {p.prompt.slice(0, 60)}</option>)}
                    </select>
                    <button className="rounded-lg border border-line px-2 py-1 text-xs font-semibold">Swap</button>
                  </form>
                )}
              </li>
            ))}
          </ol>
          {c.status === "published" && <VoidForm challengeId={c.id} positions={c.questions.filter((q) => !q.voided).map((q) => q.position)} />}
        </Panel>
      ))}

      <h2 className="font-display text-xl font-extrabold">Last 7 days</h2>
      {past.map((c) => (
        <Panel key={c.id} title={`#${c.number} · ${formatGameDate(c.date)}`} actions={<span className="text-xs text-ink-soft">{c.attempts} started · {c.completed} done</span>}>
          <ol className="list-decimal pl-5 text-sm">{c.questions.map((q) => <li key={q.position}>{q.prompt} {q.voided && <Badge tone="rejected">voided</Badge>}</li>)}</ol>
          {c.status === "published" && <VoidForm challengeId={c.id} positions={c.questions.filter((q) => !q.voided).map((q) => q.position)} />}
        </Panel>
      ))}
    </div>
  );
}

function VoidForm({ challengeId, positions }: { challengeId: string; positions: number[] }) {
  if (!positions.length) return null;
  return (
    <details className="mt-3 rounded-lg bg-paper p-3 text-sm">
      <summary className="cursor-pointer font-semibold">Correct a mistake (void a question)</summary>
      <ActionForm action={voidAction} submitLabel="Void for everyone" submitClass="btn-primary">
        <input type="hidden" name="challengeId" value={challengeId} />
        <p className="mt-2 text-ink-soft">Published questions can&apos;t be edited. Voiding gives everyone 0 for it, removes it from totals and the daily max, and shows players your reason. This is logged.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <select name="position" className="rounded-lg border border-line px-2 py-1">{positions.map((p) => <option key={p} value={p}>Q{p}</option>)}</select>
          <input name="reason" required maxLength={300} placeholder="Reason players will see" className="min-w-64 flex-1 rounded-lg border border-line px-2 py-1" />
        </div>
        <label className="mt-2 flex items-center gap-2"><input type="checkbox" name="confirm" /> I understand this changes every player&apos;s score for that day.</label>
      </ActionForm>
    </details>
  );
}
