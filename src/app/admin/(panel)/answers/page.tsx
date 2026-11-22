import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { ScoreBadge } from "@/components/ScoreBadge";
import { Badge, Panel } from "@/components/admin/ui";
import { categoryLabel } from "@/lib/labels";
import { describeMiss, formatPoints, formatValue } from "@/lib/format";
import { addDays, formatGameDate, isGameDate } from "@/lib/time";
import { today } from "@/lib/server/challenges";
import { dayAnswers, questionFlags, type AnswerPlayer, type AnswerQuestion, type AnswerRound } from "@/lib/server/admin/answers";
import { challengeFeedback, type QuestionFeedbackSummary } from "@/lib/server/feedback";
import { resolveReportsAction } from "@/app/admin/actions";

/** Admin: every player's guess, points and miss for each question of a day. */

const DIFFICULTY_LABEL: Record<string, string> = { easy: "might know", medium: "reason it out", hard: "stretch" };

function Who({ p }: { p: AnswerPlayer }) {
  return (
    <span className="flex items-center gap-2">
      <Avatar id={p.avatarId} size="sm" label="" />
      <span>{p.name}</span>
      {p.status !== "completed" && <Badge tone="bg-sun-soft">in progress</Badge>}
    </span>
  );
}

function statusText(r: AnswerRound | undefined): string {
  if (!r) return "not reached";
  if (r.status === "open") return "answering now…";
  if (r.status === "timed_out") return "time ran out";
  if (r.status === "no_answer") return "no answer";
  return "";
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function FeedbackBlock({ fb, challengeId, position }: { fb: QuestionFeedbackSummary | undefined; challengeId: string; position: number }) {
  if (!fb || (fb.up === 0 && fb.down === 0 && fb.reports.length === 0)) return null;
  const open = fb.reports.filter((r) => !r.resolved);
  return (
    <div className="mt-3 rounded-xl bg-paper p-3 text-sm">
      <p className="font-semibold">
        Player feedback: 👍 {fb.up} · 👎 {fb.down}
        {fb.reports.length > 0 && <> · {fb.reports.length} report{fb.reports.length === 1 ? "" : "s"}{open.length ? ` (${open.length} new)` : ""}</>}
      </p>
      {fb.reports.length > 0 && (
        <ul className="mt-2 space-y-1">
          {fb.reports.map((r, i) => (
            <li key={i} className={r.resolved ? "text-ink-soft" : ""}>
              <span className="font-bold">{r.name}:</span> “{r.text}”{r.resolved && " (handled)"}
            </li>
          ))}
        </ul>
      )}
      {open.length > 0 && (
        <form action={resolveReportsAction} className="mt-2">
          <input type="hidden" name="challengeId" value={challengeId} />
          <input type="hidden" name="position" value={position} />
          <button className="rounded-lg border border-line px-3 py-1 font-semibold">Mark reports handled</button>
        </form>
      )}
    </div>
  );
}

function QuestionPanel({ q, players, fb, challengeId }: { q: AnswerQuestion; players: AnswerPlayer[]; fb?: QuestionFeedbackSummary; challengeId: string }) {
  const unit = q.unit ? ` ${q.unit}` : "";
  const rows = players
    .map((p) => ({ p, r: p.rounds[q.position] }))
    .filter(({ r }) => r && r.status !== "open")
    .sort((a, b) => (b.r!.score ?? -1) - (a.r!.score ?? -1) || a.p.name.localeCompare(b.p.name));
  const guesses = rows.filter(({ r }) => r!.status === "answered").map(({ r }) => r!.guess!);
  const med = median(guesses);
  const high = guesses.filter((g) => g > q.answer).length;
  const low = guesses.filter((g) => g < q.answer).length;
  const bulls = rows.filter(({ r }) => r!.status === "answered" && (r!.score ?? 0) >= 900).length;
  const avgPts = rows.length ? Math.round(rows.reduce((s, { r }) => s + (r!.score ?? 0), 0) / rows.length) : null;
  const flags = questionFlags(q, rows.map(({ r }) => r!));

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink-soft">
            Q{q.position} · {categoryLabel(q.category)} · {DIFFICULTY_LABEL[q.difficulty] ?? q.difficulty} · {q.scoringType}
            {q.voided && <span className="ml-2 font-bold text-coral">VOIDED</span>}
          </p>
          {flags.length > 0 && (
            <p className="mt-1 flex flex-wrap gap-2">
              {flags.map((f) => (
                <span key={f.key} title={f.hint} className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${f.key === "too_easy" ? "bg-sky-soft text-sky" : "bg-coral-soft text-coral"}`}>
                  ⚑ {f.label}: {f.hint}
                </span>
              ))}
            </p>
          )}
          <h2 className="mt-1 text-lg font-bold">{q.prompt}</h2>
        </div>
        <div className="rounded-xl bg-ink px-4 py-2 text-right text-paper">
          <p className="text-xs font-bold uppercase opacity-80">Answer</p>
          <p className="font-display text-2xl font-extrabold tabular-nums">
            {formatValue(q.answer, q.scoringType)}
            {unit}
          </p>
        </div>
      </div>
      <p className="mt-2 text-sm text-ink-soft">
        {rows.length} played · {guesses.length} answered
        {med !== null && <> · median guess {formatValue(med, q.scoringType)}{unit}</>}
        {guesses.length > 0 && <> · {high} too high, {low} too low</>}
        {avgPts !== null && <> · avg {formatPoints(avgPts)} pts</>}
        {bulls > 0 && <> · {bulls} bullseye{bulls === 1 ? "" : "s"}</>}
      </p>
      <FeedbackBlock fb={fb} challengeId={challengeId} position={q.position} />
      {rows.length === 0 ? (
        <p className="mt-3 text-ink-soft">Nobody has answered this one yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-soft">
              <tr>
                <th className="py-1">Player</th>
                <th className="text-right">Guess</th>
                <th className="pl-4">How far off</th>
                <th className="text-right">Time</th>
                <th className="text-right">Points</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, r }) => (
                <tr key={p.playerId} className="border-t border-line">
                  <td className="py-1.5"><Who p={p} /></td>
                  <td className="text-right font-bold tabular-nums">{r!.status === "answered" ? `${formatValue(r!.guess!, q.scoringType)}${unit}` : "—"}</td>
                  <td className="pl-4 text-ink-soft">{r!.status === "answered" ? describeMiss(q.scoringType, q.answer, r!.guess!, q.unit) : statusText(r)}</td>
                  <td className="text-right tabular-nums text-ink-soft">{r!.secondsToAnswer !== null ? `${r!.secondsToAnswer.toFixed(1)}s` : ""}</td>
                  <td className="text-right">
                    <span className="inline-flex items-center gap-2">
                      <ScoreBadge size="sm" points={r!.score ?? 0} answered={r!.status === "answered"} voided={q.voided} />
                      <span className="w-12 font-bold tabular-nums">{formatPoints(r!.score ?? 0)}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function PlayerGrid({ questions, players }: { questions: AnswerQuestion[]; players: AnswerPlayer[] }) {
  return (
    <Panel title={`Everyone · ${players.length} player${players.length === 1 ? "" : "s"}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-ink-soft">
            <tr>
              <th className="py-1">Player</th>
              {questions.map((q) => (
                <th key={q.position} className="px-2 text-right" title={q.prompt}>
                  Q{q.position}
                  <span className="block text-xs font-normal">ans {formatValue(q.answer, q.scoringType)}</span>
                </th>
              ))}
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.playerId} className="border-t border-line align-top">
                <td className="py-1.5"><Who p={p} /></td>
                {questions.map((q) => {
                  const r = p.rounds[q.position];
                  const done = r && r.status !== "open";
                  return (
                    <td key={q.position} className="px-2 py-1.5 text-right tabular-nums">
                      {done && r.status === "answered" ? (
                        <>
                          <span className="block">{formatValue(r.guess!, q.scoringType)}</span>
                          <span className={`block text-xs font-bold ${(r.score ?? 0) >= 900 ? "text-hit" : "text-ink-soft"}`}>{formatPoints(r.score ?? 0)} pts</span>
                        </>
                      ) : (
                        <span className="text-xs text-ink-soft">{statusText(r)}</span>
                      )}
                    </td>
                  );
                })}
                <td className="py-1.5 text-right font-bold tabular-nums">{formatPoints(p.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export default async function AdminAnswers(props: PageProps<"/admin/answers">) {
  const sp = await props.searchParams;
  const t = today();
  const raw = typeof sp.date === "string" ? sp.date : t;
  const date = isGameDate(raw) && raw <= t ? raw : t;
  const view = sp.view === "player" ? "player" : "question";
  const data = await dayAnswers(date);
  const feedback = data.challenge ? await challengeFeedback(data.challenge.id) : [];
  const q = (over: Record<string, string>) => {
    const s = new URLSearchParams({ ...(date !== t ? { date } : {}), ...(view !== "question" ? { view } : {}), ...over });
    for (const [k, v] of [...s.entries()]) if (!v) s.delete(k);
    const str = s.toString();
    return str ? `?${str}` : "?";
  };
  const btn = "rounded-lg border border-line px-3 py-1.5 font-semibold";
  const tab = (v: string) => `rounded-lg px-3 py-1.5 font-semibold ${view === v ? "bg-ink text-paper" : "border border-line"}`;
  const finished = data.players.filter((p) => p.status === "completed").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-extrabold">Answers</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link className={btn} href={q({ date: addDays(date, -1) })}>‹ Previous day</Link>
          <span className="font-semibold">{formatGameDate(date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</span>
          {date < t && <Link className={btn} href={q({ date: addDays(date, 1) })}>Next day ›</Link>}
          {date !== t && <Link className="underline" href={q({ date: "" })}>Today</Link>}
        </div>
      </div>
      <p className="text-sm text-ink-soft">
        Every player&apos;s guess for each question. Admin only — players never see this. Time = seconds from the answer window opening to locking in.
      </p>

      {!data.challenge ? (
        <Panel><p className="text-ink-soft">No challenge was published for this day.</p></Panel>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-semibold">
              Challenge #{data.challenge.number} · {finished} finished{data.players.length > finished ? ` · ${data.players.length - finished} in progress` : ""}
            </p>
            <span className="ml-auto flex gap-2 text-sm">
              <Link className={tab("question")} href={q({ view: "" })}>By question</Link>
              <Link className={tab("player")} href={q({ view: "player" })}>By player</Link>
            </span>
          </div>
          {data.players.length === 0 ? (
            <Panel><p className="text-ink-soft">Nobody has played this day yet.</p></Panel>
          ) : view === "player" ? (
            <PlayerGrid questions={data.questions} players={data.players} />
          ) : (
            data.questions.map((question) => (
              <QuestionPanel key={question.position} q={question} players={data.players} challengeId={data.challenge!.id} fb={feedback.find((f) => f.position === question.position)} />
            ))
          )}
        </>
      )}
    </div>
  );
}
