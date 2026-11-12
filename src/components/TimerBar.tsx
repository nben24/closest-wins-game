"use client";

/**
 * Countdown display. It renders the server-issued deadlines (via the
 * client's clock offset) — it is not the authority. No flashing: the bar
 * changes color and the label changes text near the end.
 */
export function TimerBar({ phase, remainingMs, totalMs }: { phase: "reading" | "answering" | "done"; remainingMs: number; totalMs: number }) {
  const secs = Math.max(0, Math.ceil(remainingMs / 1000));
  const pct = Math.max(0, Math.min(100, (remainingMs / totalMs) * 100));
  const urgent = phase === "answering" && secs <= 3;
  const color = phase === "reading" ? "bg-sky" : urgent ? "bg-coral" : "bg-mint";
  const label =
    phase === "reading" ? `Read the question — answers open in ${secs}` : phase === "answering" ? (urgent ? `${secs}s left — lock it in!` : `${secs}s to answer`) : "Time's up";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-base font-bold">
        <span className={phase === "reading" ? "text-sky" : urgent ? "text-coral" : "text-mint"}>{phase === "reading" ? "Reading" : phase === "answering" ? "Answer now" : "Done"}</span>
        <span role="timer" aria-label={label} className="tabular-nums text-ink">
          {secs}s
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-line" aria-hidden="true">
        <div className={`h-full rounded-full ${color} transition-[width] duration-200 ease-linear`} style={{ width: `${pct}%` }} />
      </div>
      <p className="sr-only" aria-live="polite">
        {phase === "reading" ? "Reading time" : phase === "answering" ? (urgent ? "Three seconds left" : "Answering is open") : "Time is up"}
      </p>
    </div>
  );
}
