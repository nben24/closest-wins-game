import { MAX_PROMPT_CHARS, MAX_PROMPT_WORDS } from "@/config/game";
import { classifyQuestion, isQuestionType, type QuestionType } from "@/lib/question-types";
import { validateScoringConfig, type ScoringType } from "@/lib/scoring";

/**
 * Deterministic quality checks applied to every question — manual or
 * AI-generated. "error" blocks approval; "warning" needs a human look.
 * These reduce mistakes but cannot prove a fact is correct.
 */

export const CATEGORIES = ["everyday", "food", "animals", "entertainment", "geography", "products", "sports", "science"] as const;
export type Category = (typeof CATEGORIES)[number];
export const DIFFICULTIES = ["easy", "medium", "hard"] as const;

export interface QuestionDraft {
  prompt: string;
  answer: number;
  unit: string;
  category: string;
  difficulty: string;
  scoringType: ScoringType;
  tolerance: number;
  allowDecimal: boolean;
  allowNegative: boolean;
  explanation: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceExcerpt: string | null;
  referencePeriod: string | null;
  /** The AI's question type, when known (otherwise classified from the wording). */
  questionType?: string | null;
}

export interface CheckResult {
  level: "error" | "warning" | "info";
  code: string;
  message: string;
}

const UNSUITABLE = [
  /\b(sex|sexual|porn|nude|naked|drug overdose|suicide|murder|killed|deaths?|massacre|genocide|terror|shooting|rape|abuse|alcohol|beer|wine|vodka|whiskey|cigarette|tobacco|vape|cannabis|marijuana|gambl|casino|lottery|weapon|gun|ammunition|bomb)(?:s|es)?\b/i,
];
const CELEBRITY_WEALTH = /\b(net worth|fortune|richest|salary of|earns? per|worth)\b/i;
const VAGUE_AVERAGE = /\b(average|typical|mean|median)\b/i;
const HAS_SCOPE = /\b(in (the )?(us|u\.s\.|united states|uk|world|global|america|canada|europe|\d{4})|per (year|day|person|capita)|as of|according to|adult|in \d{4}|during|between)\b/i;
const RELATIVE_TIME = /\b(currently|right now|today|this year|last year|recently|nowadays|these days)\b/i;

/** Types whose answer is worked out from several facts, so the source quote won't contain it. */
const COMPUTED_TYPES: QuestionType[] = ["years_between", "scale", "everyday_math", "team_stats"];

/** "in a season", "a single game", "in one race"… — a generic instance. */
const GENERIC_INSTANCE = /\b(?:in an?|in one|a single|single)[\s-]+(?:[a-z]+\s+)?(season|game|race|match|tournament|event|episode|album|concert|performance)\b/i;
/** Wording that already names which instance is meant. */
const NAMES_INSTANCE = /\b(record|record-setting|record-breaking|most|best|highest|fewest|lowest|career-high|famous)\b/i;

function numbersIn(text: string): number[] {
  const nums = (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, ""))).filter(Number.isFinite);
  // "2 hours 4 minutes" also counts as 124 (minutes).
  for (const m of text.matchAll(/(\d+)\s*(?:hours?|hrs?|h)\b\s*(?:and\s*)?(\d+)\s*(?:minutes?|mins?|m)\b/gi)) nums.push(Number(m[1]) * 60 + Number(m[2]));
  return nums;
}

/**
 * Wording traps a fact-check can miss because the number itself is right:
 *  - the prompt says "in a season" but the answer is one specific season
 *    (named only in the reference period, which players see only after answering);
 *  - the source quote has numbers, but none of them is the answer.
 */
export function wordingChecks(q: Pick<QuestionDraft, "prompt" | "answer" | "scoringType" | "unit" | "category" | "sourceExcerpt" | "referencePeriod" | "questionType">): CheckResult[] {
  const out: CheckResult[] = [];
  const prompt = String(q.prompt ?? "").trim();
  if (!prompt || !Number.isFinite(q.answer)) return out;
  const generic = prompt.match(GENERIC_INSTANCE);
  if (generic && !NAMES_INSTANCE.test(prompt) && q.referencePeriod) {
    const years = (q.referencePeriod.match(/\b(1[5-9]\d\d|20\d\d)\b/g) ?? []).filter((y) => !prompt.includes(y));
    if (years.length) {
      out.push({
        level: "warning",
        code: "unnamed_instance",
        message: `The question says "${generic[0].trim()}" but the answer is about one specific ${generic[1]} (${years[0]}). Name it in the question — players only see the reference period after they answer.`,
      });
    }
  }
  const type = isQuestionType(q.questionType) && q.questionType !== "other" ? q.questionType : classifyQuestion({ prompt, scoringType: q.scoringType, unit: q.unit, category: q.category });
  if (q.sourceExcerpt && !COMPUTED_TYPES.includes(type)) {
    const nums = numbersIn(q.sourceExcerpt);
    const close = (n: number) => Math.abs(n - q.answer) <= Math.max(Math.abs(q.answer) * 0.02, 0.005);
    if (nums.length && !nums.some(close)) {
      out.push({
        level: "warning",
        code: "excerpt_number",
        message: `The source quote mentions ${nums.slice(0, 4).join(", ")}${nums.length > 4 ? "…" : ""} but not the answer (${q.answer}). Check the number.`,
      });
    }
  }
  return out;
}

export function runContentChecks(q: QuestionDraft): CheckResult[] {
  const out: CheckResult[] = [];
  const add = (level: CheckResult["level"], code: string, message: string) => out.push({ level, code, message });
  const prompt = q.prompt.trim();
  const words = prompt.split(/\s+/).filter(Boolean).length;

  if (prompt.length < 10) add("error", "prompt_short", "Prompt is too short.");
  if (prompt.length > MAX_PROMPT_CHARS || words > MAX_PROMPT_WORDS) {
    add("error", "prompt_long", `Prompt must be readable in 4 seconds (max ${MAX_PROMPT_CHARS} characters / ${MAX_PROMPT_WORDS} words; this has ${prompt.length} / ${words}).`);
  } else if (prompt.length > 95) {
    add("warning", "prompt_longish", "Prompt is on the long side for a 4-second read.");
  }
  if (!prompt.endsWith("?")) add("warning", "prompt_question_mark", "Prompts should be phrased as a question.");
  if (!CATEGORIES.includes(q.category as Category)) add("error", "category", "Unknown category.");
  if (!DIFFICULTIES.includes(q.difficulty as (typeof DIFFICULTIES)[number])) add("error", "difficulty", "Unknown difficulty.");

  for (const p of validateScoringConfig({ type: q.scoringType, tolerance: q.tolerance }, q.answer, {
    allowDecimal: q.allowDecimal,
    allowNegative: q.allowNegative,
  })) add("error", "scoring", p);

  if (q.scoringType !== "year" && !q.unit.trim()) add("warning", "unit_missing", "No unit shown — make sure the expected unit is obvious.");
  if (q.scoringType === "percent" && !/%|percent/i.test(`${q.unit} ${prompt}`)) add("warning", "percent_unit", "Percent questions should say 'percent' or use the % unit.");
  if (q.scoringType === "ratio" && q.answer > 0 && q.answer < 3) {
    add("warning", "ratio_small", "Small answers are usually better scored with absolute tolerance.");
  }
  if (q.scoringType === "absolute" && q.answer > 1000) {
    add("warning", "absolute_large", "Large positive quantities are usually better scored as ratio.");
  }

  // Ambiguity
  if (VAGUE_AVERAGE.test(prompt) && !HAS_SCOPE.test(prompt) && !q.referencePeriod) {
    add("warning", "vague_average", "Uses 'average/typical' without a population, place or period.");
  }
  if (RELATIVE_TIME.test(prompt) && !q.referencePeriod) {
    add("warning", "relative_time", "Uses a relative time ('currently', 'this year'…) without a reference period.");
  }
  if (CELEBRITY_WEALTH.test(prompt)) add("error", "celebrity_wealth", "Net-worth and earnings estimates are not allowed.");
  if (UNSUITABLE.some((r) => r.test(`${prompt} ${q.explanation}`))) add("error", "family_suitability", "Contains a topic that isn't family friendly.");

  // Precision
  const digits = String(Math.abs(q.answer)).replace(".", "").replace(/^0+/, "").replace(/0+$/, "").length;
  if (digits > 5 && q.scoringType === "ratio") {
    add("info", "precision", "The answer has many significant digits — consider rounding to what sources support.");
  }

  // Explanation & sources
  if (!q.explanation.trim()) add("warning", "explanation_missing", "Add a short reveal explanation.");
  if (q.explanation.length > 400) add("warning", "explanation_long", "Keep the reveal explanation short (under ~400 characters).");
  if (!q.sourceUrl) add("error", "source_url", "A source URL is required.");
  else if (!/^https:\/\//.test(q.sourceUrl)) add("warning", "source_https", "Prefer https:// sources.");
  if (!q.sourceTitle?.trim()) add("error", "source_title", "A source title is required.");
  if (!q.sourceExcerpt?.trim()) add("error", "source_excerpt", "A supporting excerpt from the source is required.");
  if (q.sourceUrl && /wikipedia\.org/i.test(q.sourceUrl)) add("info", "secondary_source", "Wikipedia is a secondary source — prefer a primary source where possible.");
  out.push(...wordingChecks(q));
  return out;
}

export function hasErrors(results: CheckResult[]): boolean {
  return results.some((r) => r.level === "error");
}
