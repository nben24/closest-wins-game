"use client";

import { useState } from "react";

/** Native share sheet where available, clipboard otherwise, manual copy as a last resort. */
export function ShareButton({ text, label = "Share results" }: { text: string; label?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");

  const share = async () => {
    const canNativeShare = typeof navigator !== "undefined" && "share" in navigator && window.matchMedia("(pointer: coarse)").matches;
    if (canNativeShare) {
      try {
        await navigator.share({ text });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
      setTimeout(() => setStatus("idle"), 2500);
    } catch {
      setStatus("manual");
    }
  };

  return (
    <div>
      <button type="button" className="btn-primary w-full text-xl" onClick={share}>
        <span aria-hidden="true">📤</span> {label}
      </button>
      <p role="status" aria-live="polite" className="mt-2 min-h-6 text-center text-base font-semibold text-mint">
        {status === "copied" ? "Copied! Paste it in your group chat." : ""}
      </p>
      {status === "manual" && (
        <label className="block">
          <span className="text-base text-ink-soft">Copy this text:</span>
          <textarea
            readOnly
            value={text}
            rows={5}
            className="mt-1 w-full rounded-xl border-2 border-line bg-card p-3 font-mono text-base"
            onFocus={(e) => e.currentTarget.select()}
            autoFocus
          />
        </label>
      )}
    </div>
  );
}
