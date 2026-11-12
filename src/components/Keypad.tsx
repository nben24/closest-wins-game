"use client";

import { useEffect } from "react";
import { pressKey, shiftDecimal } from "@/lib/client/number-input";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  allowDecimal: boolean;
  allowNegative: boolean;
  showMagnitudes: boolean;
  submitLabel?: string;
}

/**
 * In-app numeric keypad. Avoids the phone's software keyboard entirely, so
 * there is no keyboard overlap or layout shift, and decimal / minus keys
 * appear only when the question allows them. Physical keyboards work too.
 */
export function Keypad({ value, onChange, onSubmit, disabled, allowDecimal, allowNegative, showMagnitudes, submitLabel = "Lock it in" }: Props) {
  const opts = { allowDecimal, allowNegative };
  const press = (k: string) => {
    if (disabled) return;
    onChange(pressKey(value, k, opts));
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate?.(8);
      } catch {
        /* ignore */
      }
    }
  };

  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      let k: string | null = null;
      if (/^\d$/.test(e.key)) k = e.key;
      else if (e.key === "." || e.key === ",") k = e.key === "." ? "." : null;
      else if (e.key === "-") k = "neg";
      else if (e.key === "Backspace") k = "back";
      else if (e.key === "Escape") k = "clear";
      else if (e.key === "Enter") {
        // Let Enter activate a focused button normally.
        if (t && t.tagName === "BUTTON") return;
        e.preventDefault();
        onSubmit();
        return;
      }
      if (k) {
        e.preventDefault();
        onChange(pressKey(value, k, opts));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const keyCls =
    "h-[clamp(2.5rem,7dvh,3.5rem)] rounded-2xl border-2 border-line bg-card text-2xl font-bold text-ink shadow-[0_3px_0_#e6d6bf] active:translate-y-[2px] active:shadow-none disabled:opacity-40 touch-manipulation";
  const bottomLeft = allowNegative ? { k: "neg", label: "±", aria: "Toggle negative" } : null;
  const bottomRight = allowDecimal ? { k: ".", label: ".", aria: "Decimal point" } : null;

  return (
    <div className="select-none" aria-label="Number keypad">
      {showMagnitudes && (
        <div className="mb-1.5 grid grid-cols-3 gap-1.5">
          {[
            ["thousand", 3],
            ["million", 6],
            ["billion", 9],
          ].map(([w, k]) => (
            <button
              key={w}
              type="button"
              disabled={disabled || !value || value === "-"}
              onClick={() => onChange(shiftDecimal(value, k as number))}
              className="h-10 [@media(max-height:620px)]:h-8 rounded-xl border-2 border-line bg-paper text-base font-bold text-ink-soft disabled:opacity-40"
              aria-label={`Multiply by one ${w}`}
            >
              × {w}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-3 gap-1.5">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" className={keyCls} disabled={disabled} onClick={() => press(d)}>
            {d}
          </button>
        ))}
        {bottomLeft ? (
          <button type="button" className={keyCls} disabled={disabled} onClick={() => press(bottomLeft.k)} aria-label={bottomLeft.aria}>
            {bottomLeft.label}
          </button>
        ) : bottomRight ? (
          <button type="button" className={keyCls} disabled={disabled} onClick={() => press(bottomRight.k)} aria-label={bottomRight.aria}>
            {bottomRight.label}
          </button>
        ) : (
          <span />
        )}
        <button type="button" className={keyCls} disabled={disabled} onClick={() => press("0")}>
          0
        </button>
        <button type="button" className={keyCls} disabled={disabled || !value} onClick={() => press("back")} aria-label="Delete last digit">
          ⌫
        </button>
        {bottomLeft && bottomRight && (
          <button type="button" className={`${keyCls} col-span-3 !h-11 text-xl`} disabled={disabled} onClick={() => press(".")} aria-label="Decimal point">
            . decimal point
          </button>
        )}
      </div>
      <button type="button" className="btn-primary mt-2 w-full text-xl" disabled={disabled} onClick={onSubmit}>
        {submitLabel}
      </button>
    </div>
  );
}
