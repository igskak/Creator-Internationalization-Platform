import type { LLMUsage } from "@rc/lib/providers/llm";

// Price table per model, USD per million tokens (plan 07 §7.13). Thinking tokens are billed as
// output tokens and are already inside `outputTokens`.
//
// Source: the `claude-api` skill price cache of 2026-09-25 (Opus 5.5: $4 / $20, cache reads
// $0.20). Cache writes use the standard 5-minute rate of 1.25 × input. Cache reads of the older
// Opus models are assumed to be 0.1 × input; check them when one of those becomes active.
export type ModelPrice = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

/**
 * Cost of one call in USD, rounded to 4 decimals (the `cost_usd` column), or null for a model
 * without a price: a missing price must not become a made-up number.
 */
export function computeCostUsd(model: string, usage: LLMUsage): number | null {
  const price = MODEL_PRICES[model];
  if (!price) return null;
  const dollars =
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      (usage.cacheReadTokens ?? 0) * price.cacheRead +
      (usage.cacheWriteTokens ?? 0) * price.cacheWrite) /
    1_000_000;
  return Math.round(dollars * 10_000) / 10_000;
}
