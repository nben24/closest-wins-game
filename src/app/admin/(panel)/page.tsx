import Link from "next/link";
import { resolveNotificationAction } from "@/app/admin/actions";
import { Badge, Panel, Stat } from "@/components/admin/ui";
import { appMode, env } from "@/lib/env";
import { formatGameDate } from "@/lib/time";
import { listChallenges, openNotifications, participationStats } from "@/lib/server/admin/ops";
import { getSettings } from "@/lib/server/admin/settings";
import { monthlyUsage } from "@/lib/server/ai/pipeline";
import { aiStatus } from "@/lib/server/ai/provider";
import { inventoryStatus, today } from "@/lib/server/challenges";

export default async function Dashboard() {
  const [inv, settings, stats, notes, upcoming, usage] = await Promise.all([
    inventoryStatus(),
    getSettings(),
    participationStats(14),
    openNotifications(),
    listChallenges(today(), 4),
    monthlyUsage(),
  ]);
  const ai = aiStatus();
  const low = inv.inventoryDays < settings.inventoryThresholdDays;
  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-extrabold">Dashboard</h1>
      {appMode() === "local" && (
        <p className="rounded-xl bg-plum-soft p-3 text-sm text-plum">
          Local mode: embedded database with <strong>demo questions (unverified)</strong>. Demo content is {env.allowDemoContent ? "allowed" : "not allowed"} in schedules.
        </p>
      )}
      {!ai.configured && (
        <p className="rounded-xl bg-sun-soft p-3 text-sm">
          <strong>AI generation unavailable:</strong> ANTHROPIC_API_KEY is not configured. You can still add, review and schedule questions manually.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Inventory" value={`${inv.inventoryDays} days`} hint={<span className={low ? "font-bold text-coral" : ""}>{low ? `Below ${settings.inventoryThresholdDays}-day threshold` : `Threshold ${settings.inventoryThresholdDays} days`}</span>} />
        <Stat label="Scheduled ahead" value={`${inv.scheduledAheadDays} days`} hint={inv.firstUnscheduledDate ? `First gap: ${formatGameDate(inv.firstUnscheduledDate)}` : undefined} />
        <Stat label="Approved reserve" value={inv.unscheduledApproved} hint="Approved, never used" />
        <Stat label="Review queue" value={<Link className="underline" href="/admin/questions?status=review">{inv.reviewQueue}</Link>} />
      </div>

      {notes.length > 0 && (
        <Panel title="Notifications">
          <ul className="divide-y divide-line">
            {notes.map((n) => (
              <li key={n.id} className="flex items-start justify-between gap-3 py-2">
                <span><Badge tone={n.severity}>{n.severity}</Badge> <span className="ml-1">{n.message}</span> <span className="text-xs text-ink-soft">{n.created_at.toISOString().slice(0, 16).replace("T", " ")} UTC</span></span>
                <form action={resolveNotificationAction}><input type="hidden" name="id" value={n.id} /><button className="text-sm font-semibold text-ink-soft underline">Dismiss</button></form>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Upcoming challenges" actions={<Link href="/admin/schedule" className="text-sm font-semibold underline">Schedule ›</Link>}>
          {upcoming.length === 0 && <p className="text-ink-soft">Nothing scheduled. Players will get a set assembled from the reserve.</p>}
          <ul className="space-y-3">
            {upcoming.map((c) => (
              <li key={c.id}>
                <p className="font-bold">#{c.number} · {formatGameDate(c.date, { weekday: "short", month: "short", day: "numeric" })} <Badge>{c.status}</Badge> {c.isDemo && <Badge tone="demo">demo</Badge>}</p>
                <ol className="ml-5 list-decimal text-sm text-ink-soft">
                  {c.questions.map((q) => <li key={q.position}>{q.prompt} <span className="text-ink">({q.difficulty})</span></li>)}
                </ol>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Participation (last 14 days)">
          <p className="text-sm text-ink-soft">{stats.players} players total · {stats.activePlayers7d} active in 7 days · {stats.groups} groups</p>
          <table className="mt-2 w-full text-sm">
            <thead><tr className="text-left text-ink-soft"><th>Date</th><th className="text-right">Started</th><th className="text-right">Completed</th><th className="text-right">Avg score</th></tr></thead>
            <tbody>
              {stats.days.map((d) => (
                <tr key={d.date} className="border-t border-line"><td className="py-1">{formatGameDate(d.date)}</td><td className="text-right tabular-nums">{d.started}</td><td className="text-right tabular-nums">{d.completed}</td><td className="text-right tabular-nums">{d.avgScore ?? "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
      <Panel title="Inventory by category (approved reserve)">
        <div className="flex flex-wrap gap-2 text-sm">
          {Object.entries(inv.byCategory).map(([k, n]) => <span key={k} className="chip">{k}: {n}</span>)}
          {Object.entries(inv.byDifficulty).map(([k, n]) => <span key={k} className="chip">{k}: {n}</span>)}
        </div>
      </Panel>
      <p className="text-sm text-ink-soft">
        AI: {ai.configured ? `${ai.provider} · ${ai.model}` : "not configured"} · This month (estimated): ${usage.costUsd.toFixed(2)} of ${settings.monthlyCostLimitUsd} ·{" "}
        {usage.proposals} of {settings.monthlyQuestionLimit} proposals · Automation: generate {settings.autoGenerate ? "on" : "off"}, approve{" "}
        {settings.autoApprove ? "on" : "off"}, schedule {settings.autoSchedule ? "on" : "off"}
      </p>
    </div>
  );
}
