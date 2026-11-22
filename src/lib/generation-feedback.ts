/**
 * Player feedback for the question generator (pure; the server loads the data).
 *
 * Before each batch the generator is shown how real players did on recent
 * games: which questions they did well on (they had a way in), which flopped
 * (nobody had a way in), how each difficulty label actually scored, and every
 * question played or scheduled recently, so it stops repeating the same people,
 * films, products and formulas. No player names or ids are involved; only
 * per-question averages.
 */

export interface PlayedQuestion {
  date: string;
  prompt: string;
  difficulty: string;
  /** Finished players who saw the question (blanks and time-outs count as 0 points). */
  players: number;
  avgPoints: number;
  /** Players' "fun question?" thumbs (optional, from the results screen). */
  up?: number;
  down?: number;
}

/** What each difficulty should average with real players (points out of 1000). */
export const DIFFICULTY_TARGETS: Record<"easy" | "medium" | "hard", { min: number; max: number }> = {
  easy: { min: 550, max: 800 },
  medium: { min: 380, max: 600 },
  hard: { min: 250, max: 450 },
};

/** Fewer players than this and a question's average is mostly noise. */
export const MIN_PLAYERS = 5;
const GOOD = 450;
const FLOP = 150;

export interface FeedbackSummary {
  byDifficulty: { difficulty: "easy" | "medium" | "hard"; count: number; avg: number; verdict: "too_hard" | "too_easy" | "on_target" }[];
  good: PlayedQuestion[];
  flops: PlayedQuestion[];
  /** Labeled easy, but players scored like it was hard. */
  falseEasy: PlayedQuestion[];
  /** Players' favorites and least favorites by thumbs up/down (whatever they scored). */
  loved: PlayedQuestion[];
  disliked: PlayedQuestion[];
}

/** Votes needed before a question's thumbs count. */
export const MIN_VOTES = 3;
const votes = (q: PlayedQuestion) => (q.up ?? 0) + (q.down ?? 0);
const net = (q: PlayedQuestion) => ((q.up ?? 0) - (q.down ?? 0)) / Math.max(1, votes(q));

export function summarizePlay(played: PlayedQuestion[]): FeedbackSummary | null {
  const usable = played.filter((q) => q.players >= MIN_PLAYERS && Number.isFinite(q.avgPoints));
  if (usable.length < 5) return null;
  const byDifficulty = (["easy", "medium", "hard"] as const).flatMap((d) => {
    const qs = usable.filter((q) => q.difficulty === d);
    if (!qs.length) return [];
    const avg = Math.round(qs.reduce((s, q) => s + q.avgPoints, 0) / qs.length);
    const t = DIFFICULTY_TARGETS[d];
    return [{ difficulty: d, count: qs.length, avg, verdict: avg < t.min ? ("too_hard" as const) : avg > t.max ? ("too_easy" as const) : ("on_target" as const) }];
  });
  const byScore = [...usable].sort((a, b) => b.avgPoints - a.avgPoints);
  return {
    byDifficulty,
    good: byScore.filter((q) => q.avgPoints >= GOOD).slice(0, 6),
    flops: byScore.filter((q) => q.avgPoints < FLOP).reverse().slice(0, 6),
    falseEasy: usable.filter((q) => q.difficulty === "easy" && q.avgPoints < 250).sort((a, b) => a.avgPoints - b.avgPoints).slice(0, 4),
    loved: usable.filter((q) => votes(q) >= MIN_VOTES && net(q) >= 0.5).sort((a, b) => net(b) - net(a) || votes(b) - votes(a)).slice(0, 6),
    disliked: usable.filter((q) => votes(q) >= MIN_VOTES && net(q) <= -0.3).sort((a, b) => net(a) - net(b) || votes(b) - votes(a)).slice(0, 6),
  };
}

const line = (q: PlayedQuestion) => `- "${q.prompt}" (${q.difficulty}, players averaged ${Math.round(q.avgPoints)})`;

/** The feedback block added to the generator's request. Empty when there's nothing useful to say. */
export function feedbackText(played: PlayedQuestion[], recentPrompts: string[]): string {
  const parts: string[] = [];
  const s = summarizePlay(played);
  if (s) {
    const levels = s.byDifficulty
      .map((d) => {
        const t = DIFFICULTY_TARGETS[d.difficulty];
        const v = d.verdict === "too_hard" ? "TOO HARD, make these easier" : d.verdict === "too_easy" ? "too easy, make these harder" : "about right";
        return `- ${d.difficulty}: averaged ${d.avg} over ${d.count} questions (target ${t.min}–${t.max}): ${v}`;
      })
      .join("\n");
    parts.push(`How real players scored recently (points out of 1000 per question). Label difficulty by how THESE players will score, not by how famous the fact is:
${levels}`);
    if (s.good.length) parts.push(`Questions players did well on. They had a way in; aim for that feel, with new subjects and formulas:\n${s.good.map(line).join("\n")}`);
    if (s.flops.length) parts.push(`Flops: players had no way in and were typing random numbers. Don't write anything like these:\n${s.flops.map(line).join("\n")}`);
    const thumbs = (q: PlayedQuestion) => `- "${q.prompt}" (👍 ${q.up ?? 0}, 👎 ${q.down ?? 0}; players averaged ${Math.round(q.avgPoints)})`;
    if (s.loved.length) parts.push(`Players' favorites, by their own thumbs up. Write more questions with this feel:\n${s.loved.map(thumbs).join("\n")}`);
    if (s.disliked.length) parts.push(`Players gave these a thumbs down. Avoid this kind of question:\n${s.disliked.map(thumbs).join("\n")}`);
    if (s.falseEasy.length) parts.push(`Labeled easy, but players struggled. These are NOT easy; easy means most players get close:\n${s.falseEasy.map(line).join("\n")}`);
  }
  if (recentPrompts.length) {
    parts.push(`Played recently or already scheduled. Don't reuse the same people, teams, films, shows, products or brands, and don't write another question with the same formula (another launch price, another movie runtime, another calorie count):
${recentPrompts.slice(0, 60).map((p) => `- ${p}`).join("\n")}`);
  }
  return parts.join("\n\n");
}
