import { QUESTIONS_PER_DAY } from "@/config/game";
import { familyOf, type QuestionType } from "@/lib/question-types";
import { sameSubject, similarity } from "@/lib/similarity";

/**
 * Pick a balanced set of five questions for one day.
 *
 * Rules (strict pass first, then progressively relaxed):
 *  1. Difficulty mix: target easy, easy, medium, medium, hard — i.e. 2 "might
 *     know this", 2 "reason it out", 1 "stretch"; never more than
 *     one hard question (two only in an emergency reserve fill).
 *  2. Five different categories where possible (so at most one sports question).
 *  3. Five different question types ("what year", "how far", "price"…) where possible.
 *     Types in the same family (a launch price and a "what did it cost in
 *     1980") count as one, since players feel them as the same question.
 *  4. No category three days in a row, no type that the neighbouring days
 *     already use, and types seen less in
 *     the surrounding two weeks are preferred — so the same kind of question
 *     doesn't come back day after day.
 *  5. No near-duplicate subjects within the day or with recently used subjects.
 * Selection is deterministic for a given seed (the date), so reruns are stable.
 * Final order: easy, medium, easy, hard, medium (a gentle start, no stacking).
 */

export interface PoolQuestion {
  id: string;
  prompt: string;
  category: string;
  difficulty: "easy" | "medium" | "hard";
  subjectKey: string;
  type: QuestionType;
}

/** A question used on another day near the one being picked. */
export interface NearbyQuestion {
  prompt: string;
  subjectKey: string;
  date?: string;
  type?: QuestionType;
  category?: string;
}

function dayGap(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed: string): () => number {
  let a = hashSeed(seed) || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function conflicts(q: PoolQuestion, others: { prompt: string; subjectKey: string }[]): boolean {
  return others.some((o) => sameSubject(q.subjectKey, o.subjectKey) || similarity(q.prompt, o.prompt) >= 0.5);
}

const TARGET: PoolQuestion["difficulty"][] = ["easy", "easy", "medium", "medium", "hard"];
const ORDER: Record<PoolQuestion["difficulty"], number[]> = { easy: [0, 2], medium: [1, 4], hard: [3] };

export function pickDailySet(
  pool: PoolQuestion[],
  opts: { seed: string; date?: string; recent?: NearbyQuestion[]; emergency?: boolean },
): PoolQuestion[] | null {
  const rand = seededRandom(opts.seed);
  const recent = opts.recent ?? [];
  const date = opts.date ?? opts.seed;
  const near = (days: number) => recent.filter((r) => r.date && dayGap(r.date, date) <= days);
  const adjacentTypes = new Set(near(1).map((r) => r.type && familyOf(r.type)).filter(Boolean));
  const typeSeen = new Map<string, number>();
  const catSeen = new Map<string, number>();
  for (const r of near(7)) if (r.type) typeSeen.set(familyOf(r.type), (typeSeen.get(familyOf(r.type)) ?? 0) + 1);
  // Categories: the day before/after counts double, two days away counts once.
  for (const r of near(2)) if (r.category) catSeen.set(r.category, (catSeen.get(r.category) ?? 0) + (r.date && dayGap(r.date, date) <= 1 ? 2 : 1));

  // A category on two neighbouring days in a row would make a streak of three: avoid it.
  const catsOn = (offset: number) => new Set(recent.filter((r) => r.date && r.category && dayGap(r.date, date) === Math.abs(offset) && (offset < 0 ? r.date < date : r.date > date)).map((r) => r.category!));
  const [m2, m1, p1, p2] = [catsOn(-2), catsOn(-1), catsOn(1), catsOn(2)];
  const streakCats = new Set([...m1].filter((c) => m2.has(c) || p1.has(c)).concat([...p1].filter((c) => p2.has(c))));

  // Seeded shuffle, then prefer types/categories that the surrounding days used less.
  const shuffled = [...pool].sort((a, b) => a.id.localeCompare(b.id));
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const weight = new Map(shuffled.map((q) => [q, (typeSeen.get(familyOf(q.type)) ?? 0) + 0.75 * (catSeen.get(q.category) ?? 0) + rand() * 1.5]));
  const ordered = shuffled.sort((a, b) => weight.get(a)! - weight.get(b)!);

  type Pass = { distinctCategories: boolean; distinctTypes: boolean; avoidAdjacentTypes: boolean; avoidStreaks?: boolean; avoidRecent: boolean; difficultyTargets: boolean; maxHard: number };
  const passes: Pass[] = [
    { distinctCategories: true, distinctTypes: true, avoidAdjacentTypes: true, avoidStreaks: true, avoidRecent: true, difficultyTargets: true, maxHard: 1 },
    { distinctCategories: true, distinctTypes: true, avoidAdjacentTypes: false, avoidStreaks: true, avoidRecent: true, difficultyTargets: true, maxHard: 1 },
    { distinctCategories: true, distinctTypes: true, avoidAdjacentTypes: false, avoidRecent: true, difficultyTargets: true, maxHard: 1 },
    { distinctCategories: true, distinctTypes: false, avoidAdjacentTypes: false, avoidRecent: true, difficultyTargets: true, maxHard: 1 },
    { distinctCategories: false, distinctTypes: true, avoidAdjacentTypes: false, avoidRecent: true, difficultyTargets: true, maxHard: 1 },
    { distinctCategories: false, distinctTypes: false, avoidAdjacentTypes: false, avoidRecent: true, difficultyTargets: true, maxHard: 1 },
    { distinctCategories: false, distinctTypes: false, avoidAdjacentTypes: false, avoidRecent: false, difficultyTargets: true, maxHard: 1 },
    { distinctCategories: false, distinctTypes: false, avoidAdjacentTypes: false, avoidRecent: false, difficultyTargets: false, maxHard: 1 },
  ];
  if (opts.emergency) passes.push({ ...passes[passes.length - 1], maxHard: 2 });

  for (const pass of passes) {
    const picked: PoolQuestion[] = [];
    const tryPick = (want: PoolQuestion["difficulty"] | null) => {
      for (const q of ordered) {
        if (picked.includes(q)) continue;
        if (want && q.difficulty !== want) continue;
        if (q.difficulty === "hard" && picked.filter((p) => p.difficulty === "hard").length >= pass.maxHard) continue;
        if (pass.distinctCategories && picked.some((p) => p.category === q.category)) continue;
        if (pass.distinctTypes && q.type !== "other" && picked.some((p) => familyOf(p.type) === familyOf(q.type))) continue;
        if (pass.avoidAdjacentTypes && adjacentTypes.has(familyOf(q.type))) continue;
        if (pass.avoidStreaks && streakCats.has(q.category)) continue;
        if (conflicts(q, picked)) continue;
        if (pass.avoidRecent && conflicts(q, recent)) continue;
        picked.push(q);
        return true;
      }
      return false;
    };
    if (pass.difficultyTargets) {
      for (const d of TARGET) if (!tryPick(d)) tryPick(d === "hard" ? "medium" : null);
    }
    while (picked.length < QUESTIONS_PER_DAY && tryPick(null)) {
      /* fill */
    }
    if (picked.length === QUESTIONS_PER_DAY) return orderSet(picked);
  }
  return null;
}

export function orderSet(set: PoolQuestion[]): PoolQuestion[] {
  const slots: (PoolQuestion | null)[] = Array(set.length).fill(null);
  const rest: PoolQuestion[] = [];
  const used = { easy: 0, medium: 0, hard: 0 };
  for (const q of set) {
    const slot = ORDER[q.difficulty][used[q.difficulty]++];
    if (slot !== undefined && slots[slot] === null) slots[slot] = q;
    else rest.push(q);
  }
  for (let i = 0; i < slots.length; i++) if (!slots[i]) slots[i] = rest.shift()!;
  return slots as PoolQuestion[];
}

/**
 * Pick one replacement for a slot in an already-scheduled day (pure).
 * Prefers, in order: the same difficulty; a type family and category the rest
 * of the day doesn't have; a type family the surrounding days (±3) didn't use;
 * and never a near-duplicate of the day's other questions or nearby days'.
 * Falls back step by step so a day can always be filled if the pool has anything.
 */
export function pickReplacement(
  pool: PoolQuestion[],
  opts: { difficulty: PoolQuestion["difficulty"]; day: PoolQuestion[]; nearby?: NearbyQuestion[]; date?: string; seed: string },
): PoolQuestion | null {
  if (!pool.length) return null;
  const rand = seededRandom(opts.seed);
  const nearby = opts.nearby ?? [];
  const dayFamilies = new Set(opts.day.map((q) => familyOf(q.type)));
  const dayCats = new Set(opts.day.map((q) => q.category));
  const nearFamilies = new Set(
    nearby.filter((r) => r.type && (!opts.date || !r.date || dayGap(r.date, opts.date) <= 3)).map((r) => familyOf(r.type!)),
  );
  const ordered = [...pool].sort((a, b) => a.id.localeCompare(b.id)).map((q) => ({ q, r: rand() })).sort((a, b) => a.r - b.r).map((x) => x.q);
  const tests: ((q: PoolQuestion) => boolean)[] = [
    (q) => q.difficulty === opts.difficulty && !dayFamilies.has(familyOf(q.type)) && !dayCats.has(q.category) && !nearFamilies.has(familyOf(q.type)),
    (q) => q.difficulty === opts.difficulty && !dayFamilies.has(familyOf(q.type)) && !dayCats.has(q.category),
    (q) => q.difficulty === opts.difficulty && !dayFamilies.has(familyOf(q.type)),
    (q) => q.difficulty === opts.difficulty,
    (q) => !dayFamilies.has(familyOf(q.type)) && !(q.difficulty === "hard" && opts.day.some((d) => d.difficulty === "hard")),
    () => true,
  ];
  for (const ok of tests) {
    const hit = ordered.find((q) => ok(q) && !conflicts(q, opts.day) && !conflicts(q, nearby));
    if (hit) return hit;
  }
  return ordered.find((q) => !conflicts(q, opts.day)) ?? ordered[0];
}
