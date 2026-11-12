"use client";

import { Avatar } from "@/components/Avatar";
import { formatValue } from "@/lib/format";
import type { NumberLine as Line } from "@/lib/insights";
import type { ScoringType } from "@/lib/scoring";

/** Guesses from players who finished, on one line with the real answer. */
export function NumberLine({ line, answer, type, unit }: { line: Line; answer: number; type: ScoringType; unit: string }) {
  const sorted = [...line.points].sort((a, b) => a.x - b.x);
  // stagger overlapping avatars into rows
  const rows: number[] = [];
  const placed = sorted.map((p) => {
    let row = 0;
    while (rows[row] !== undefined && p.x - rows[row] < 0.09) row++;
    rows[row] = p.x;
    return { ...p, row };
  });
  const height = 44 + Math.max(1, rows.length) * 38;
  return (
    <figure className="mt-3">
      <div className="relative mx-4" style={{ height }}>
        <div className="absolute inset-x-0 bottom-8 h-1 rounded-full bg-ink/20" />
        <div className="absolute bottom-3 -translate-x-1/2 text-center" style={{ left: `${line.answerX * 100}%` }}>
          <div className="mx-auto h-9 w-1 rounded bg-coral" />
          <div className="mt-0.5 whitespace-nowrap rounded-md bg-coral px-1.5 text-xs font-bold text-white">
            {formatValue(answer, type)}
          </div>
        </div>
        {placed.map((p) => (
          <div
            key={p.playerId}
            className="absolute -translate-x-1/2"
            style={{ left: `${p.x * 100}%`, bottom: 44 + p.row * 38 }}
            title={`${p.isViewer ? "You" : p.name}: ${formatValue(p.guess, type)} ${unit}`}
          >
            <div className={`rounded-full ${p.isViewer ? "ring-4 ring-ink" : ""}`}>
              <Avatar id={p.avatarId} size="sm" label={`${p.isViewer ? "You" : p.name}: ${formatValue(p.guess, type)}`} />
            </div>
            {p.clamped && (
              <span
                className={`absolute top-1/2 -translate-y-1/2 text-base font-extrabold text-ink ${p.clamped === "high" ? "-right-4" : "-left-4"}`}
                aria-hidden="true"
              >
                {p.clamped === "high" ? "›" : "‹"}
              </span>
            )}
          </div>
        ))}
      </div>
      <figcaption className="mt-1 flex justify-between px-1 text-xs font-semibold text-ink-soft">
        <span>{formatValue(line.min, type)}</span>
        <span>{line.scale === "log" ? "log scale · arrows = off the chart" : "arrows = off the chart"}</span>
        <span>{formatValue(line.max, type)}</span>
      </figcaption>
    </figure>
  );
}
