/**
 * Lightweight text similarity used for duplicate detection and for keeping
 * near-duplicate subjects apart in daily schedules.
 */

const STOPWORDS = new Set(
  "a an the of in on at to for from by with and or is are was were be been how many much what which who when where whose does do did it its this that these those there their about approximately roughly average typical standard per one".split(
    " ",
  ),
);

export function normalizePrompt(prompt: string): string {
  return prompt
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9%]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function contentTokens(text: string): Set<string> {
  return new Set(
    normalizePrompt(text)
      .split(" ")
      .filter((w) => w.length > 1 && !STOPWORDS.has(w))
      .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function trigrams(s: string): Set<string> {
  const t = `  ${normalizePrompt(s)} `;
  const out = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}

/** 0..1, max of token Jaccard and character-trigram Jaccard. */
export function similarity(a: string, b: string): number {
  return Math.max(jaccard(contentTokens(a), contentTokens(b)), jaccard(trigrams(a), trigrams(b)));
}

export function normalizeSubject(s: string): string {
  return [...contentTokens(s)].sort().join(" ");
}

export function sameSubject(a: string, b: string): boolean {
  if (!a || !b) return false;
  const na = normalizeSubject(a);
  const nb = normalizeSubject(b);
  return na === nb || jaccard(new Set(na.split(" ")), new Set(nb.split(" "))) >= 0.6;
}

export interface SimilarHit<T> {
  item: T;
  score: number;
}

export function mostSimilar<T>(prompt: string, items: T[], getText: (t: T) => string, limit = 5): SimilarHit<T>[] {
  return items
    .map((item) => ({ item, score: similarity(prompt, getText(item)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Threshold above which two prompts are treated as near-duplicates. */
export const NEAR_DUPLICATE_THRESHOLD = 0.62;
