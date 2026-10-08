import { computeCostUsd, STAGE_CONFIG } from "@rc/modules/ai";
import type { EvalCase } from "./case";

// A rough cost preview before a live run (07 §7.13): the harness asks for confirmation with these
// numbers. The token counts are typical sizes of the real prompts, not measurements; the real cost
// is recorded per run and shown in the report.

type Estimate = { calls: number; typicalUsd: number | null; worstCaseUsd: number | null };

/** Typical input and output tokens of one call per stage. */
const TOKENS = {
  MARKET_ADAPTATION: { input: 6_000, output: 2_500 },
  CONTENT_WRITING: { input: 8_000, output: 3_000 },
  CRITIC: { input: 9_000, output: 1_500 },
  EVAL_JUDGE: { input: 3_500, output: 600 },
} as const;

const price = (stage: keyof typeof TOKENS, calls: number): number | null => {
  const config = STAGE_CONFIG[stage];
  const one = computeCostUsd(config.model, {
    inputTokens: TOKENS[stage].input,
    outputTokens: TOKENS[stage].output,
  });
  return one === null ? null : one * calls;
};
const sum = (parts: (number | null)[]): number | null =>
  parts.some((p) => p === null) ? null : (parts as number[]).reduce((a, b) => a + b, 0);

/**
 * Per case with M markets: M plans, M drafts and M reviews (typical); worst case adds two rewrites
 * (a draft and a review each) per market. The judge adds one call per market.
 */
export function estimateRun(cases: readonly EvalCase[], options: { judge: boolean }): Estimate {
  let calls = 0;
  const typical: (number | null)[] = [];
  const worst: (number | null)[] = [];
  for (const c of cases) {
    const m = c.markets.length;
    const judge = options.judge ? m : 0;
    calls += 3 * m + judge;
    typical.push(price("MARKET_ADAPTATION", m), price("CONTENT_WRITING", m), price("CRITIC", m));
    worst.push(
      price("MARKET_ADAPTATION", m * 2),
      price("CONTENT_WRITING", m * 3),
      price("CRITIC", m * 3),
    );
    if (judge) {
      typical.push(price("EVAL_JUDGE", judge));
      worst.push(price("EVAL_JUDGE", judge));
    }
  }
  const round = (x: number | null) => (x === null ? null : Math.round(x * 100) / 100);
  return { calls, typicalUsd: round(sum(typical)), worstCaseUsd: round(sum(worst)) };
}

export const describeEstimate = (e: Estimate, model: string): string =>
  e.typicalUsd === null
    ? `${e.calls} model calls with ${model}; no price is known for this model, so no estimate.`
    : `${e.calls} model calls with ${model}: about $${e.typicalUsd.toFixed(2)} (up to $${(e.worstCaseUsd ?? 0).toFixed(2)} with rewrites). A rough guess; the report shows the real cost.`;
