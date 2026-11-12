"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Onboarding } from "@/components/Onboarding";
import { QuestionCard, categoryLabel } from "@/components/QuestionCard";
import { RevealPanel } from "@/components/RevealPanel";
import { ScoreBadge } from "@/components/ScoreBadge";
import { CenterMessage, Shell, Spinner } from "@/components/Shell";
import { TimerBar } from "@/components/TimerBar";
import { api, ApiClientError, clockOffset } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { playTone } from "@/lib/client/sound";
import { formatPoints } from "@/lib/format";
import type { PlayState, RoundView, SubmitResult } from "@/lib/server/play";

function newSubmissionId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function store(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}
function load(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
/** Which reveals were dismissed is remembered per browser, not per tab. */
function loadAck(challengeId: string): number {
  try {
    return Number(localStorage.getItem(`cw-ack-${challengeId}`) ?? "0") || 0;
  } catch {
    return 0;
  }
}
function storeAck(challengeId: string, position: number) {
  try {
    localStorage.setItem(`cw-ack-${challengeId}`, String(position));
  } catch {
    /* ignore */
  }
}

export function PlayClient() {
  const { status, me } = useSession();
  if (status === "loading") return <Shell hideNav><Spinner /></Shell>;
  if (!me) return <Shell hideNav><Onboarding /></Shell>;
  return (
    <Shell compact>
      <Game />
    </Shell>
  );
}

function Game() {
  const router = useRouter();
  const [state, setState] = useState<PlayState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [ack, setAck] = useState(0); // last position whose reveal the player dismissed
  const offset = useRef(0); // for callbacks
  const [offsetMs, setOffsetMs] = useState(0); // for rendering
  const submissionId = useRef<string>(newSubmissionId());
  const submittedFor = useRef<string | null>(null);

  const apply = useCallback((s: PlayState, sentAt: number) => {
    offset.current = clockOffset(s.serverNow, sentAt, Date.now());
    setOffsetMs(offset.current);
    setState(s);
    if (s.challenge) {
      const saved = loadAck(s.challenge.id);
      setAck((a) => Math.max(a, saved));
    }
  }, []);

  const refresh = useCallback(async () => {
    const t0 = Date.now();
    try {
      apply(await api<PlayState>("/api/play/state"), t0);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  }, [apply]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    void refresh();
  }, [refresh]);

  const open = state?.rounds.find((r) => r.status === "open") ?? null;
  const challengeId = state?.challenge?.id ?? null;

  // Tick while a round is open.
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNowMs(Date.now()), 100);
    return () => clearInterval(t);
  }, [open]);

  // Restore a draft for the open round (e.g. after a refresh).
  useEffect(() => {
    if (open && challengeId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync from storage
      setDraft(load(`cw-draft-${challengeId}-${open.position}`) ?? "");
      submissionId.current = load(`cw-sub-${challengeId}-${open.position}`) ?? newSubmissionId();
      store(`cw-sub-${challengeId}-${open.position}`, submissionId.current);
    }
  }, [open?.position, challengeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateDraft = (v: string) => {
    setDraft(v);
    if (open && challengeId) store(`cw-draft-${challengeId}-${open.position}`, v);
  };

  const serverNow = nowMs + offsetMs;
  const opensAt = open ? new Date(open.answerOpensAt).getTime() : 0;
  const deadline = open ? new Date(open.deadlineAt).getTime() : 0;
  const phase: "reading" | "answering" | "expired" | null = !open ? null : serverNow < opensAt ? "reading" : serverNow < deadline ? "answering" : "expired";

  const submit = useCallback(
    async (value: string) => {
      if (!open || !challengeId) return;
      const key = `${challengeId}-${open.position}`;
      if (submittedFor.current === key) return;
      submittedFor.current = key;
      setSubmitting(true);
      const graceEnd = deadline + (state?.timing.submitGraceMs ?? 1500);
      for (let attempt = 0; attempt < 4; attempt++) {
        const t0 = Date.now();
        try {
          const r = await api<SubmitResult>("/api/play/submit", {
            body: { challengeId, position: open.position, guess: value.trim() === "" ? null : value, submissionId: submissionId.current },
          });
          apply(r.state, t0);
          store(`cw-draft-${key}`, null);
          store(`cw-sub-${key}`, null);
          const s = r.round.reveal?.score ?? 0;
          playTone(s >= 700 ? "reveal-good" : "reveal-ok");
          setSubmitting(false);
          return;
        } catch (e) {
          const retryable = e instanceof ApiClientError && (e.code === "network" || e.status >= 500);
          if (e instanceof ApiClientError && e.code === "too_early") {
            await new Promise((res) => setTimeout(res, 300));
            continue;
          }
          if (!retryable || Date.now() + offset.current > graceEnd) break;
          await new Promise((res) => setTimeout(res, 400));
        }
      }
      // Fall back to whatever the server decided.
      setSubmitting(false);
      submittedFor.current = null;
      await refresh();
    },
    [open, challengeId, deadline, state?.timing.submitGraceMs, apply, refresh],
  );

  // Auto-submit the current entry when time runs out.
  useEffect(() => {
    // Reacting to the clock crossing the deadline is exactly what an effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (phase === "expired" && !submitting) void submit(draft);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const begin = async (position: number) => {
    if (!challengeId) return;
    setBusy(true);
    const t0 = Date.now();
    try {
      apply(await api<PlayState>("/api/play/begin", { body: { challengeId, position } }), t0);
      setNowMs(Date.now());
    } catch (e) {
      if (e instanceof ApiClientError && (e.code === "out_of_order" || e.code === "challenge_changed")) await refresh();
      else setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const acknowledge = (position: number) => {
    setAck(position);
    if (challengeId) storeAck(challengeId, position);
    if (state?.attempt?.status === "completed") router.push("/results");
  };

  if (error && !state) return <CenterMessage title="Something went wrong">{error}</CenterMessage>;
  if (!state) return <Spinner />;
  if (!state.challenge) {
    return (
      <CenterMessage title="Today's challenge isn't ready yet">
        <p>Please check back a little later.</p>
        <Link href="/practice" className="btn-soft mt-4">Practice instead</Link>
      </CenterMessage>
    );
  }

  const finished = state.rounds.filter((r) => r.status !== "open");
  const unacked = finished.filter((r) => r.position > ack).sort((a, b) => a.position - b.position)[0];

  const progress = (
    <ol className="mb-3 flex items-center justify-center gap-2" aria-label="Progress">
      {[1, 2, 3, 4, 5].map((p) => {
        const r = state.rounds.find((x) => x.position === p);
        const done = r && r.status !== "open";
        const current = r?.status === "open" || (!r && state.nextPosition === p);
        return (
          <li
            key={p}
            className={`h-2.5 w-10 rounded-full ${done ? "bg-ink" : current ? "bg-coral" : "bg-line"}`}
            aria-label={`Question ${p}: ${done ? "done" : current ? "current" : "upcoming"}`}
          />
        );
      })}
    </ol>
  );

  const miniProgress = (
    <span className="flex gap-1" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((p) => {
        const r = state.rounds.find((x) => x.position === p);
        return <span key={p} className={`h-2 w-4 rounded-full ${r && r.status !== "open" ? "bg-ink" : r ? "bg-coral" : "bg-line"}`} />;
      })}
    </span>
  );

  // 1) A finished round the player hasn't dismissed yet → reveal.
  if (unacked && !open) {
    return <Reveal round={unacked} isDemo={state.challenge.isDemo} progress={progress} total={state.attempt?.totalScore ?? 0} last={state.attempt?.status === "completed"} onNext={() => acknowledge(unacked.position)} />;
  }

  // 2) An open round → question with timer.
  if (open && phase) {
    const reading = phase === "reading";
    const remaining = reading ? opensAt - serverNow : Math.max(0, deadline - serverNow);
    return (
      <div>
        <QuestionCard
          progress={miniProgress}
          position={open.position}
          prompt={open.prompt}
          unit={open.unit}
          category={open.category}
          scoringType={open.scoringType}
          allowDecimal={open.allowDecimal}
          allowNegative={open.allowNegative}
          value={draft}
          onChange={updateDraft}
          onSubmit={() => phase === "answering" && void submit(draft)}
          inputEnabled={phase === "answering" && !submitting}
          timer={<TimerBar phase={phase === "expired" ? "done" : phase} remainingMs={remaining} totalMs={reading ? state.timing.readingMs : state.timing.answerMs} />}
          statusNote={submitting ? "Locking in your answer…" : phase === "expired" ? "Time's up — checking your answer…" : null}
        />
      </div>
    );
  }

  // 3) All done.
  if (state.attempt?.status === "completed") {
    return (
      <CenterMessage title="You're done for today!">
        <p className="font-display text-4xl font-extrabold text-ink">{formatPoints(state.attempt.totalScore)} pts</p>
        <Link href="/results" className="btn-primary mt-4 w-full">See results</Link>
      </CenterMessage>
    );
  }

  // 4) Ready screen for the next question. The timer starts only when the player taps.
  const pos = state.nextPosition ?? 1;
  return (
    <div className="space-y-4">
      {progress}
      <section className="card p-6 text-center" aria-labelledby="ready-heading">
        <p className="label">Question {pos} of 5</p>
        {state.nextCategory && <p className="mt-2"><span className="chip text-base">{categoryLabel(state.nextCategory)}</span></p>}
        <h1 id="ready-heading" className="mt-4 font-display text-3xl font-extrabold">Ready?</h1>
        <p className="mt-2 text-lg text-ink-soft">
          You&apos;ll get 4 seconds to read, then 10 seconds to answer.
        </p>
        <button type="button" className="btn-primary mt-6 w-full text-xl" disabled={busy} onClick={() => begin(pos)} autoFocus>
          {busy ? "Starting…" : "Show the question"}
        </button>
      </section>
      {state.attempt && (
        <p className="text-center text-lg text-ink-soft">
          Score so far: <span className="font-bold text-ink tabular-nums">{formatPoints(state.attempt.totalScore)}</span>
        </p>
      )}
      {error && <p role="alert" className="text-center font-semibold text-coral">{error}</p>}
    </div>
  );
}

function Reveal({ round, isDemo, progress, total, last, onNext }: { round: RoundView; isDemo: boolean; progress: React.ReactNode; total: number; last: boolean; onNext: () => void }) {
  const r = round.reveal!;
  return (
    <div className="space-y-4">
      {progress}
      <RevealPanel
        position={round.position}
        isDemo={isDemo}
        data={{ ...r, prompt: round.prompt, unit: round.unit, scoringType: round.scoringType, status: round.status }}
      />
      <div className="flex items-center justify-between px-1">
        <span className="text-lg text-ink-soft">Total</span>
        <span className="font-display text-2xl font-extrabold tabular-nums">{formatPoints(total)}</span>
      </div>
      <button type="button" className="btn-ink w-full text-xl" onClick={onNext} autoFocus>
        {last ? "See my results" : "Next question"}
      </button>
      <p className="sr-only">
        <ScoreBadge points={r.score} answered={r.guess !== null} voided={r.voided} />
      </p>
    </div>
  );
}
