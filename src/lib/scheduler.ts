import { QUESTIONS_PER_DAY } from "@/config/game";
import { sameSubject, similarity } from "@/lib/similarity";

/**
 * Pick a balanced set of five questions for one day.
 *
 * Rules (strict pass first, then progressively relaxed):
 *  1. Difficulty mix: target easy, easy, medium, medium, hard; never more than
 *     one hard question (two only in an emergency reserve fill).
 *  2. Five different categories where possible.
 *  3. No near-duplicate subjects within the day or with recently used subjects.
 * Selection is deterministic for a given seed (the date), so reruns are stable.
 * Final order: easy, medium, easy, hard, medium (a gentle start, no stacking).
 */

export interface PoolQuestion {
  id: string;
  prompt: string;
  category: string;
  difficulty: "easy" | "medium" | "hard";
  subjectKey: string;
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
  opts: { seed: string; recent?: { prompt: string; subjectKey: string }[]; emergency?: boolean },
): PoolQuestion[] | null {
  const rand = seededRandom(opts.seed);
  const shuffled = [...pool].sort((a, b) => a.id.localeCompare(b.id));
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const recent = opts.recent ?? [];

  const passes: { distinctCategories: boolean; avoidRecent: boolean; difficultyTargets: boolean; maxHard: number }[] = [
    { distinctCategories: true, avoidRecent: true, difficultyTargets: true, maxHard: 1 },
    { distinctCategories: false, avoidRecent: true, difficultyTargets: true, maxHard: 1 },
    { distinctCategories: false, avoidRecent: false, difficultyTargets: true, maxHard: 1 },
    { distinctCategories: false, avoidRecent: false, difficultyTargets: false, maxHard: 1 },
  ];
  if (opts.emergency) passes.push({ distinctCategories: false, avoidRecent: false, difficultyTargets: false, maxHard: 2 });

  for (const pass of passes) {
    const picked: PoolQuestion[] = [];
    const tryPick = (want: PoolQuestion["difficulty"] | null) => {
      for (const q of shuffled) {
        if (picked.includes(q)) continue;
        if (want && q.difficulty !== want) continue;
        if (q.difficulty === "hard" && picked.filter((p) => p.difficulty === "hard").length >= pass.maxHard) continue;
        if (pass.distinctCategories && picked.some((p) => p.category === q.category)) continue;
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
