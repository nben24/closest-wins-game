import { scoreBand } from "@/lib/scoring";

const STYLES: Record<string, string> = {
  bullseye: "bg-primary text-primary-fg",
  close: "bg-mint-soft text-mint",
  warm: "bg-sun-soft text-ink",
  ballpark: "bg-coral-soft text-coral",
  far: "bg-plum-soft text-plum",
  none: "bg-line text-ink-soft",
};

/** Band shown with symbol + words, never color alone. */
export function ScoreBadge({ points, answered = true, voided = false, size = "md" }: { points: number; answered?: boolean; voided?: boolean; size?: "sm" | "md" }) {
  const b = scoreBand(points, answered, voided);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-bold ${STYLES[b.key]} ${size === "sm" ? "px-2.5 py-0.5 text-sm" : "px-3 py-1 text-base"}`}>
      <span aria-hidden="true">{b.symbol}</span>
      {b.label}
    </span>
  );
}
