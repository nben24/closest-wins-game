"use client";

import { useId, useState } from "react";
import { api } from "@/lib/client/api";

const MAX = 300;

/**
 * "Fun question? 👍 👎" plus an optional "Something wrong?" report, shown under
 * each answer on the results screen once the day is finished. Only the game's
 * host (admin) sees what players send.
 */
export function QuestionFeedback({ date, position, initialReaction, initialReported }: {
  date: string;
  position: number;
  initialReaction: -1 | 1 | null;
  initialReported: boolean;
}) {
  const [reaction, setReaction] = useState(initialReaction);
  const [reported, setReported] = useState(initialReported);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxId = useId();

  async function react(v: -1 | 1) {
    const next = reaction === v ? null : v;
    const prev = reaction;
    setReaction(next);
    setError(null);
    try {
      await api("/api/feedback", { body: { date, position, reaction: next } });
    } catch (e) {
      setReaction(prev);
      setError(e instanceof Error ? e.message : "Couldn't save that.");
    }
  }

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/feedback", { body: { date, position, report: text } });
      setReported(true);
      setOpen(false);
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send that.");
    } finally {
      setBusy(false);
    }
  }

  const thumb = (v: -1 | 1, label: string, icon: string) => (
    <button
      type="button"
      onClick={() => react(v)}
      aria-pressed={reaction === v}
      aria-label={label}
      className={`flex min-h-11 min-w-11 items-center justify-center rounded-xl border-2 text-xl ${
        reaction === v ? (v === 1 ? "border-hit bg-hit-soft" : "border-coral bg-coral-soft") : "border-line bg-card"
      }`}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );

  return (
    <div className="rounded-2xl bg-paper px-4 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-base font-semibold text-ink-soft">Fun question?</span>
        <span className="flex gap-2">
          {thumb(1, `Question ${position} was fun`, "👍")}
          {thumb(-1, `Question ${position} wasn't fun`, "👎")}
        </span>
        <span className="ml-auto text-base">
          {reported ? (
            <span className="font-semibold text-ink-soft">Thanks, the host will take a look.</span>
          ) : !open ? (
            <button type="button" onClick={() => setOpen(true)} className="min-h-11 font-semibold text-ink-soft underline underline-offset-2">
              Something wrong?
            </button>
          ) : null}
        </span>
      </div>
      {open && !reported && (
        <div className="mt-2 space-y-2 pb-2">
          <label htmlFor={boxId} className="block text-base font-semibold">What looks wrong with question {position}?</label>
          <textarea
            id={boxId}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX))}
            rows={3}
            maxLength={MAX}
            placeholder="e.g. the answer is out of date, or the question was confusing"
            className="w-full rounded-xl border-2 border-line bg-card p-2 text-base"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={send} disabled={busy || !text.trim()} className="btn-primary">
              {busy ? "Sending…" : "Send to the host"}
            </button>
            <button type="button" onClick={() => { setOpen(false); setText(""); }} className="btn-ghost">Cancel</button>
            <span className="ml-auto text-sm text-ink-soft">{text.length}/{MAX}</span>
          </div>
        </div>
      )}
      {error && <p role="alert" className="pb-1 text-sm font-semibold text-coral">{error}</p>}
    </div>
  );
}
