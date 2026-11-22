/**
 * Question types ("angles"): what kind of thinking a question asks for,
 * independent of its category. Used to keep generation and daily sets varied:
 * a day of "what year…", "how many miles…" and "launch price…" feels
 * repetitive even when the categories differ.
 *
 * New AI questions carry the type the model chose; older and manual questions
 * are classified from their wording (free, no AI call).
 */

export const QUESTION_TYPES = [
  "year",
  "years_between",
  "price",
  "then_vs_now",
  "calories",
  "runtime",
  "awards",
  "team_stats",
  "rules",
  "distance",
  "weight",
  "measure",
  "speed_rate",
  "duration",
  "everyday_math",
  "scale",
  "percent",
  "record",
  "count",
  "other",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const TYPE_INFO: Record<QuestionType, { label: string; describe: string }> = {
  year: { label: "What year", describe: "the year a well-known event, invention or release happened" },
  years_between: { label: "Years between", describe: "combine two well-known facts: how many years apart two events were" },
  price: { label: "Price", describe: "what a familiar product costs or cost at launch" },
  then_vs_now: { label: "Then vs now", describe: "what something everyday cost, or how it was, in a specific past year" },
  calories: { label: "Nutrition", describe: "calories or nutrition in a familiar food or drink" },
  runtime: { label: "Runtime", describe: "how long a well-known movie, show, song or album runs" },
  awards: { label: "Awards & titles", describe: "how many awards, titles or medals a famous person, team or film won (answer 5 or more)" },
  team_stats: { label: "Team & player stats", describe: "a famous sports team's or athlete's total over a named span of seasons" },
  rules: { label: "Game rules & sizes", describe: "rules, sizes and numbers built into a sport or game" },
  distance: { label: "Distance & size", describe: "how far, long, tall or big something familiar is (miles, feet)" },
  weight: { label: "Weight", describe: "how heavy something familiar is (pounds)" },
  measure: { label: "Kitchen & household measures", describe: "everyday measures and conversions people use without thinking" },
  speed_rate: { label: "Speed & rate", describe: "how fast something goes or how often something happens per minute or hour" },
  duration: { label: "How long it takes", describe: "how long something takes: to build, grow, hatch, travel, cook or live" },
  everyday_math: { label: "Everyday math", describe: "how many times something happens in a day, a year or a lifetime (reason it out)" },
  scale: { label: "Scale comparison", describe: "how many of a familiar thing would fit inside, stack up to or line up along another" },
  percent: { label: "Percent & polls", describe: "a percentage — best of all, what percent of US adults do or believe something, from a named survey" },
  record: { label: "Records & contests", describe: "a famous world record or the winning number in a well-known contest" },
  count: { label: "Hidden counts", describe: "count the parts of something familiar that people see all the time but have never counted" },
  other: { label: "Other", describe: "anything else with a way in" },
};

/** Types the generator may be asked to write ("other" is only a fallback label). */
export const GENERATABLE_TYPES = QUESTION_TYPES.filter((t) => t !== "other");

export function isQuestionType(v: unknown): v is QuestionType {
  return typeof v === "string" && (QUESTION_TYPES as readonly string[]).includes(v);
}

/** Classify a question from its wording. Order matters: the first match wins. */
export function classifyQuestion(q: { prompt: string; scoringType?: string; unit?: string; category?: string }): QuestionType {
  const p = q.prompt.toLowerCase();
  const sports = q.category === "sports";
  if (q.scoringType === "percent" || /\bpercent(age)?\b|%/.test(p)) return "percent";
  if (/\byears? (passed|separated|apart|after|before|elapsed)\b|\bhow many years (between|from)\b/.test(p)) return "years_between";
  if (q.scoringType === "year" || /\b(in )?what year\b/.test(p)) return "year";
  if (/\b(price|cost|costs|pay)\b/.test(p) && /\b(in|during|throughout|of) (the year )?(1[89]\d\d|20[01]\d)\b/.test(p) && !/\blaunch\b/.test(p)) return "then_vs_now";
  if (/\b(price|cost|costs|dollars|cents)\b|\$/.test(p)) return "price";
  if (/\bcalories?\b|\bkcal\b/.test(p) || /kcal|calorie/.test(q.unit ?? "")) return "calories";
  if (/\b(academy awards?|oscars?|grammys?|emmys?|gold medals?|medals|championships?|titles?|super bowls|mvp|number-one|world series|pennants?|finals)\b/.test(p)) return "awards";
  if (/\bseasons?\b/.test(p) && /\b(wins?|won|games|losses|lost|points|runs|goals|playoffs?|postseason|appearances)\b/.test(p)) return "team_stats";
  if (/\bworld record\b|\brecord\b|\bcontest\b|\bwinner\b/.test(p)) return "record";
  if (/\b(laid end to end|stack(ed)?|would it take|would fit|line up)\b/.test(p)) return "scale";
  if (sports && /\b(regulation|official|standard|court|field|pool|rim|roster|round of golf|holes|end zones?|marathon|shot put|stitches|players)\b/.test(p)) return "rules";
  if (/\b(film|movie|episode|album|song)\b/.test(p) && /\bminutes?\b|\bruntime\b|\bhow long\b/.test(p)) return "runtime";
  if (/\bhow many times\b|\bin (one|a) (full )?(day|week|year|lifetime)\b|\bper (day|year)\b/.test(p)) return "everyday_math";
  if (/\bper (minute|second|hour)\b|\bmph\b|miles per hour|\bheart rate\b|\bspeed\b|\bhow fast\b/.test(p)) return "speed_rate";
  if (/\bhow long does it take\b|\btake to\b|\bdid it take\b|\bto (build|hatch|boil|walk|grow|travel|orbit|reach)\b|\bpregnancy\b|\bgestation\b|\blifespan\b|\bsleep\b|\blast\b/.test(p)) return "duration";
  if (/\b(pounds|weigh|weighs|weight|lb|tons|grams|ounces? heavy)\b/.test(p)) return "weight";
  if (/\b(teaspoons?|tablespoons?|fluid ounces|fl oz|cups?|sticks of butter|gallons?|ream)\b/.test(p)) return "measure";
  if (/\b(miles|feet|foot|yards|inches|meters|metres|kilometers|kilometres|km|tall|long|high|deep|far|distance|area)\b/.test(p)) return "distance";
  if (/\bhow many\b|\badd up\b|\bin total\b/.test(p)) return "count";
  return "other";
}

/** The type stored by the generator when valid, otherwise classified from the wording. */
export function typeOf(q: { storedType?: string | null; prompt: string; scoringType?: string; unit?: string; category?: string }): QuestionType {
  return isQuestionType(q.storedType) && q.storedType !== "other" ? q.storedType : classifyQuestion(q);
}

/** Most questions of one type allowed in a single generation job. */
export function perJobTypeCap(target: number): number {
  return Math.max(1, Math.ceil(target / 8));
}

/**
 * Pick `count` different types for the next proposal batch, favoring types the
 * bank has least of, and never more than `cap` of one type per job. Pure; pass
 * a seeded `rand` in tests.
 */
export function planTypes(
  count: number,
  bankCounts: Partial<Record<QuestionType, number>>,
  jobCounts: Partial<Record<QuestionType, number>>,
  cap: number,
  rand: () => number = Math.random,
): QuestionType[] {
  const open = GENERATABLE_TYPES.filter((t) => (jobCounts[t] ?? 0) < cap);
  const pool = open.length ? open : [...GENERATABLE_TYPES];
  const score = (t: QuestionType) => (bankCounts[t] ?? 0) + 4 * (jobCounts[t] ?? 0) + rand() * 3;
  const ranked = pool.map((t) => ({ t, s: score(t) })).sort((a, b) => a.s - b.s);
  return ranked.slice(0, count).map((r) => r.t);
}

/** The most common types in the bank (to tell the generator what to avoid). */
export function crowdedTypes(bankCounts: Partial<Record<QuestionType, number>>, n = 5): QuestionType[] {
  return (Object.entries(bankCounts) as [QuestionType, number][])
    .filter(([t, c]) => t !== "other" && c >= 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t]) => t);
}

/**
 * Types that feel like the same question to players. "What did the Walkman
 * cost at launch" and "what did a movie ticket cost in 1980" are both "guess
 * a price", so variety rules treat them as one.
 */
const FAMILY: Partial<Record<QuestionType, string>> = { price: "price", then_vs_now: "price" };
export function familyOf(t: QuestionType): string {
  return FAMILY[t] ?? t;
}
/** Every type in the same family as `t` (including `t`). */
export function familyMembers(t: QuestionType): QuestionType[] {
  const f = familyOf(t);
  return QUESTION_TYPES.filter((x) => familyOf(x) === f);
}
