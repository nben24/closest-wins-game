"use client";

import { useActionState, useMemo, useState } from "react";
import { saveQuestionAction } from "@/app/admin/actions";
import { inputCls } from "@/components/admin/ui";
import { categoryLabel, formatHint } from "@/components/QuestionCard";
import { CATEGORIES, DIFFICULTIES, runContentChecks } from "@/lib/content-checks";
import { formatValue } from "@/lib/format";
import { DEFAULT_TOLERANCE, previewGuesses, SCORING_TYPES, scoreGuess, type ScoringType } from "@/lib/scoring";

export interface QuestionFormValues {
  id?: string;
  prompt: string;
  answer: string;
  unit: string;
  category: string;
  difficulty: string;
  scoringType: ScoringType;
  tolerance: string;
  allowDecimal: boolean;
  allowNegative: boolean;
  explanation: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceExcerpt: string;
  referencePeriod: string;
  subject: string;
}

export const EMPTY_QUESTION: QuestionFormValues = {
  prompt: "",
  answer: "",
  unit: "",
  category: "everyday",
  difficulty: "medium",
  scoringType: "ratio",
  tolerance: String(DEFAULT_TOLERANCE.ratio),
  allowDecimal: false,
  allowNegative: false,
  explanation: "",
  sourceUrl: "",
  sourceTitle: "",
  sourceExcerpt: "",
  referencePeriod: "",
  subject: "",
};

const TOLERANCE_HELP: Record<ScoringType, (t: number) => string> = {
  ratio: (t) => `Half points when the guess is off by a factor of ×${t} (either direction). Use ~1.2–1.3 for well-known facts, ~1.5 medium, 2–3 for wild guesses.`,
  absolute: (t) => `Half points when the guess is ${t} unit(s) away. Good for small counts and values that can be zero or negative.`,
  year: (t) => `Half points when the guess is ${t} year(s) away. 2000 vs 2010 is a 10-year miss, not a 0.5% miss.`,
  percent: (t) => `Half points when the guess is ${t} percentage point(s) away.`,
};

export function QuestionForm({ initial, readOnly = false }: { initial: QuestionFormValues; readOnly?: boolean }) {
  const [v, setV] = useState(initial);
  const [state, formAction, pending] = useActionState(saveQuestionAction, {});
  const set = <K extends keyof QuestionFormValues>(k: K, val: QuestionFormValues[K]) => setV((p) => ({ ...p, [k]: val }));

  const answer = Number(v.answer.replace(/,/g, ""));
  const tolerance = Number(v.tolerance);
  const valid = v.answer.trim() !== "" && Number.isFinite(answer) && Number.isFinite(tolerance) && tolerance > 0;

  const checks = useMemo(
    () =>
      valid
        ? runContentChecks({
            prompt: v.prompt,
            answer,
            unit: v.unit,
            category: v.category,
            difficulty: v.difficulty,
            scoringType: v.scoringType,
            tolerance,
            allowDecimal: v.allowDecimal,
            allowNegative: v.allowNegative,
            explanation: v.explanation,
            sourceUrl: v.sourceUrl || null,
            sourceTitle: v.sourceTitle || null,
            sourceExcerpt: v.sourceExcerpt || null,
            referencePeriod: v.referencePeriod || null,
          })
        : [],
    [v, answer, tolerance, valid],
  );
  const preview = valid
    ? previewGuesses({ type: v.scoringType, tolerance }, answer).filter((g) => (v.allowNegative || g >= 0) && (v.allowDecimal || Number.isInteger(g)) || g === answer)
    : [];

  const field = (label: string, el: React.ReactNode, hint?: string) => (
    <label className="block text-sm font-bold">
      {label}
      {el}
      {hint && <span className="mt-1 block text-xs font-normal text-ink-soft">{hint}</span>}
    </label>
  );

  return (
    <form action={formAction} className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <fieldset disabled={readOnly} className="space-y-4">
        {v.id && <input type="hidden" name="id" value={v.id} />}
        {field(
          `Prompt (${v.prompt.length} chars)`,
          <textarea name="prompt" className={inputCls} rows={2} value={v.prompt} onChange={(e) => set("prompt", e.target.value)} required />,
          "One short sentence ending in '?'. Must be readable in 4 seconds. State place, period, size or edition when it matters.",
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {field("Answer", <input name="answer" className={inputCls} inputMode="decimal" value={v.answer} onChange={(e) => set("answer", e.target.value)} required />)}
          {field("Unit", <input name="unit" className={inputCls} value={v.unit} onChange={(e) => set("unit", e.target.value)} placeholder="keys, miles, %" />)}
          {field(
            "Category",
            <select name="category" className={inputCls} value={v.category} onChange={(e) => set("category", e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{categoryLabel(c)}</option>
              ))}
            </select>,
          )}
          {field(
            "Difficulty",
            <select name="difficulty" className={inputCls} value={v.difficulty} onChange={(e) => set("difficulty", e.target.value)}>
              {DIFFICULTIES.map((c) => <option key={c}>{c}</option>)}
            </select>,
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {field(
            "Scoring",
            <select
              name="scoringType"
              className={inputCls}
              value={v.scoringType}
              onChange={(e) => {
                const t = e.target.value as ScoringType;
                setV((p) => ({ ...p, scoringType: t, tolerance: String(DEFAULT_TOLERANCE[t]), allowDecimal: t === "year" ? false : p.allowDecimal, allowNegative: t === "ratio" ? false : p.allowNegative }));
              }}
            >
              {SCORING_TYPES.map((c) => <option key={c}>{c}</option>)}
            </select>,
          )}
          {field("Tolerance", <input name="tolerance" className={inputCls} inputMode="decimal" value={v.tolerance} onChange={(e) => set("tolerance", e.target.value)} required />)}
          <label className="flex items-center gap-2 pt-6 text-sm font-bold">
            <input type="checkbox" name="allowDecimal" checked={v.allowDecimal} onChange={(e) => set("allowDecimal", e.target.checked)} /> Decimals
          </label>
          <label className="flex items-center gap-2 pt-6 text-sm font-bold">
            <input type="checkbox" name="allowNegative" checked={v.allowNegative} onChange={(e) => set("allowNegative", e.target.checked)} /> Negatives
          </label>
        </div>
        <p className="rounded-lg bg-paper p-3 text-sm">{Number.isFinite(tolerance) && tolerance > 0 ? TOLERANCE_HELP[v.scoringType](tolerance) : "Enter a tolerance."}</p>
        {field(
          "Reveal explanation",
          <textarea name="explanation" className={inputCls} rows={3} value={v.explanation} onChange={(e) => set("explanation", e.target.value)} />,
          "1–2 sentences that make players go \"oh wow\".",
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {field("Source URL", <input name="sourceUrl" type="url" className={inputCls} value={v.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} placeholder="https://…" />, "Prefer a primary source.")}
          {field("Source title", <input name="sourceTitle" className={inputCls} value={v.sourceTitle} onChange={(e) => set("sourceTitle", e.target.value)} />)}
        </div>
        {field(
          "Supporting excerpt (verbatim from the source, must include the number)",
          <textarea name="sourceExcerpt" className={inputCls} rows={3} value={v.sourceExcerpt} onChange={(e) => set("sourceExcerpt", e.target.value)} />,
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {field("Reference period", <input name="referencePeriod" className={inputCls} value={v.referencePeriod} onChange={(e) => set("referencePeriod", e.target.value)} placeholder="e.g. 2024, as of 2023 season" />)}
          {field("Subject key", <input name="subject" className={inputCls} value={v.subject} onChange={(e) => set("subject", e.target.value)} placeholder="e.g. piano keys" />, "Short key used for duplicate detection.")}
        </div>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-ink min-h-10 text-base" disabled={pending}>{pending ? "Saving…" : v.id ? "Save changes" : "Add to review queue"}</button>
            {state.error && <p role="alert" className="text-sm font-semibold text-coral">{state.error}</p>}
          </div>
        )}
      </fieldset>

      <aside className="space-y-4">
        <div className="rounded-2xl border border-line bg-card p-4">
          <p className="text-xs font-bold text-ink-soft uppercase">Player preview</p>
          <p className="mt-1 text-sm text-ink-soft">{categoryLabel(v.category)} · {v.difficulty}</p>
          <p className="mt-2 font-display text-xl leading-tight font-extrabold">{v.prompt || "Your question…"}</p>
          <p className="mt-2 text-sm text-ink-soft">
            Answer in: <strong>{v.unit || "(no unit)"}</strong> · {formatHint(v.scoringType, v.allowDecimal, v.allowNegative)}
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-card p-4">
          <p className="text-xs font-bold text-ink-soft uppercase">Scoring preview</p>
          {valid ? (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-ink-soft"><th>Guess</th><th className="text-right">Points</th></tr>
              </thead>
              <tbody>
                {preview.map((g) => (
                  <tr key={g} className={g === answer ? "font-bold" : ""}>
                    <td className="py-0.5 tabular-nums">{formatValue(g, v.scoringType)}{g === answer ? " (exact)" : ""}</td>
                    <td className="py-0.5 text-right tabular-nums">{scoreGuess({ type: v.scoringType, tolerance }, answer, g)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-2 text-sm text-ink-soft">Enter an answer and tolerance.</p>
          )}
        </div>
        <div className="rounded-2xl border border-line bg-card p-4">
          <p className="text-xs font-bold text-ink-soft uppercase">Automated checks</p>
          <ul className="mt-2 space-y-1 text-sm">
            {checks.length === 0 && <li className="text-mint">No problems found.</li>}
            {checks.map((c, i) => (
              <li key={i} className={c.level === "error" ? "text-coral" : c.level === "warning" ? "text-ink" : "text-ink-soft"}>
                {c.level === "error" ? "✖" : c.level === "warning" ? "⚠" : "ℹ"} {c.message}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-soft">Automated checks reduce errors but don&apos;t guarantee correctness. Always open the source.</p>
        </div>
      </aside>
    </form>
  );
}
