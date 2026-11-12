/**
 * ESTIMATED costs, for the admin usage log and budget limits only. Prices are
 * per million tokens (USD), from Anthropic's published list prices at the
 * time of writing; check https://www.anthropic.com/pricing for current rates.
 * Web search is billed per search.
 */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-fable-5-2": { input: 8, output: 40 },
};
export const WEB_SEARCH_USD_PER_SEARCH = 0.01;
/** Used for models not in the table, so budgets stay conservative. */
const FALLBACK_PRICE = { input: 8, output: 40 };

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number, webSearches: number): number {
  const p = MODEL_PRICES[model] ?? FALLBACK_PRICE;
  return (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output + webSearches * WEB_SEARCH_USD_PER_SEARCH;
}
