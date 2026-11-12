import type { ReactNode } from "react";

export function Panel({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="font-display text-lg font-extrabold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

const TONE: Record<string, string> = {
  approved: "bg-mint-soft text-mint",
  auto_passed: "bg-mint-soft text-mint",
  admin_verified: "bg-mint-soft text-mint",
  accepted: "bg-mint-soft text-mint",
  completed: "bg-mint-soft text-mint",
  published: "bg-mint-soft text-mint",
  review: "bg-sky-soft text-sky",
  scheduled: "bg-sky-soft text-sky",
  running: "bg-sky-soft text-sky",
  queued: "bg-sky-soft text-sky",
  held: "bg-sun-soft text-ink",
  needs_review: "bg-sun-soft text-ink",
  paused: "bg-sun-soft text-ink",
  warning: "bg-sun-soft text-ink",
  draft: "bg-paper text-ink-soft",
  unverified: "bg-plum-soft text-plum",
  demo: "bg-plum-soft text-plum",
  rejected: "bg-coral-soft text-coral",
  failed: "bg-coral-soft text-coral",
  error: "bg-coral-soft text-coral",
  archived: "bg-line text-ink-soft",
  cancelled: "bg-line text-ink-soft",
};

export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${TONE[tone ?? String(children)] ?? "bg-paper text-ink-soft"}`}>{children}</span>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <p className="text-xs font-bold tracking-wide text-ink-soft uppercase">{label}</p>
      <p className="mt-1 font-display text-3xl font-extrabold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-sm text-ink-soft">{hint}</p>}
    </div>
  );
}

export const inputCls = "mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-base";
