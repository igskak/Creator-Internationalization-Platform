import type { CaseOutcome } from "./runner";

// The metrics of plan 07 §7.12 over one case's outcome. Every value is a plain number (or null when
// there is nothing to measure) so a report can be compared run to run.

export type ExpectationResults = {
  /** Card keys some market's draft did not cite. */
  mustCiteMissing: { market: string; key: string }[];
  forbiddenHits: { market: string; phrase: string }[];
  requiredMissing: { market: string; text: string }[];
  /** True when the markets' hook types differ (or the case does not ask). */
  hookTypesDiffer: boolean;
};

export type CaseMetrics = {
  /** Variants READY_FOR_REVIEW of those asked for. */
  completionRate: number;
  /** Pipeline model runs that gave a valid answer (SUCCEEDED or REPAIRED) of all of them. */
  schemaValidRate: number | null;
  /** Share of valid runs that needed the repair. */
  repairRate: number | null;
  /** Factual slides that cite a card, of all factual slides. */
  citationCoverage: number | null;
  /** Variants with no numeric mismatch flag or issue, of the finished ones. */
  numericFidelityRate: number | null;
  /** Unsupported claims the critic listed (last review). */
  criticUnsupportedClaims: number;
  /** Unsupported claims the judge listed. */
  judgeUnsupportedClaims: number | null;
  /** Mean of the critic's quality score of the finished variants. */
  meanQualityScore: number | null;
  /** Mean judge scores over the markets; null without a judge. */
  judge: { factualFidelity: number; localization: number; voice: number } | null;
  /** The worst comparison of the markets. */
  differentiation: {
    verdict: "OK" | "WARN" | "FAIL";
    hookSimilarity: number;
    slideTextSimilarity: number;
  } | null;
  rewrites: number;
  criticVerdicts: Record<string, number>;
  flags: Record<string, number>;
  pipelineMs: number;
  pipelineCostUsd: number | null;
  judgeCostUsd: number | null;
  expectations: ExpectationResults;
};

const mean = (values: readonly number[]): number | null =>
  values.length === 0
    ? null
    : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
const ratio = (num: number, den: number): number | null =>
  den === 0 ? null : Math.round((num / den) * 10_000) / 10_000;
const SEVERITY = { OK: 0, WARN: 1, FAIL: 2 } as const;

/** All the text a reader sees in a variant, lower-cased for phrase checks. */
export function variantText(variant: CaseOutcome["variants"][number]): string {
  return [
    variant.hook ?? "",
    ...variant.slides.flatMap((s) => Object.values(s.slots)),
    variant.caption ?? "",
    variant.cta?.text ?? "",
    ...variant.hashtags,
  ]
    .join("\n")
    .normalize("NFC");
}

export function computeMetrics(outcome: CaseOutcome): CaseMetrics {
  const { case: evalCase, variants, runs, judgements } = outcome;
  const finished = variants.filter((v) => v.hasContent && v.status === "READY_FOR_REVIEW");

  const valid = runs.filter((r) => r.status === "SUCCEEDED" || r.status === "REPAIRED");
  const factual = finished.flatMap((v) => v.slides.filter((s) => s.factual));
  const cited = factual.filter((s) => s.knowledgeIds.length > 0);
  const numericBad = finished.filter(
    (v) =>
      v.flags.includes("NUMERIC_MISMATCH") ||
      (v.critic?.deterministicIssues ?? []).some((i) => i.code === "NUMERIC_MISMATCH"),
  );
  const judged = Object.values(judgements).flatMap((j) => ("scores" in j ? [j] : []));
  const worst = variants
    .map((v) => v.differentiation)
    .filter((d) => d !== null)
    .sort((a, b) => SEVERITY[b.verdict] - SEVERITY[a.verdict])[0];

  const count = (items: readonly string[]) =>
    items.reduce<Record<string, number>>(
      (acc, item) => ({ ...acc, [item]: (acc[item] ?? 0) + 1 }),
      {},
    );

  // --- expectations ---------------------------------------------------------------------------
  const lower = (text: string) => text.toLowerCase();
  const inMarket = (rule: { market?: string | undefined }, code: string) =>
    !rule.market || rule.market === code;
  const mustCiteMissing = finished.flatMap((v) =>
    evalCase.expect.mustCite
      .filter((key) => !v.slides.some((s) => s.knowledgeIds.includes(outcome.cardIds[key] ?? "")))
      .map((key) => ({ market: v.marketCode, key })),
  );
  const forbiddenHits = finished.flatMap((v) =>
    evalCase.expect.forbiddenPhrases
      .filter((rule) => inMarket(rule, v.marketCode))
      .flatMap((rule) => rule.phrases)
      .filter((phrase) => lower(variantText(v)).includes(lower(phrase)))
      .map((phrase) => ({ market: v.marketCode, phrase })),
  );
  const requiredMissing = finished.flatMap((v) =>
    evalCase.expect.requiredText
      .filter((rule) => inMarket(rule, v.marketCode))
      .filter((rule) => !lower(variantText(v)).includes(lower(rule.text)))
      .map((rule) => ({ market: v.marketCode, text: rule.text })),
  );
  const hookTypes = finished.map((v) => v.hookType);
  const hookTypesDiffer =
    !evalCase.expect.hookTypesDiffer || new Set(hookTypes).size === hookTypes.length;

  return {
    completionRate: ratio(finished.length, variants.length) ?? 0,
    schemaValidRate: ratio(valid.length, runs.filter((r) => r.stage !== "EVAL_JUDGE").length),
    repairRate: ratio(valid.filter((r) => r.status === "REPAIRED").length, valid.length),
    citationCoverage: ratio(cited.length, factual.length),
    numericFidelityRate: ratio(finished.length - numericBad.length, finished.length),
    criticUnsupportedClaims: finished.reduce(
      (n, v) => n + (v.critic?.unsupportedClaims.length ?? 0),
      0,
    ),
    judgeUnsupportedClaims:
      judged.length === 0 ? null : judged.reduce((n, j) => n + j.unsupportedClaims.length, 0),
    meanQualityScore: mean(
      finished.flatMap((v) => (v.qualityScore === null ? [] : [v.qualityScore])),
    ),
    judge:
      judged.length === 0
        ? null
        : {
            factualFidelity: mean(judged.map((j) => j.scores.factualFidelity)) ?? 0,
            localization: mean(judged.map((j) => j.scores.localization)) ?? 0,
            voice: mean(judged.map((j) => j.scores.voice)) ?? 0,
          },
    differentiation: worst
      ? {
          verdict: worst.verdict,
          hookSimilarity: worst.hookSimilarity,
          slideTextSimilarity: worst.slideTextSimilarity,
        }
      : null,
    rewrites: finished.reduce((n, v) => n + (v.critic?.iteration ?? 0), 0),
    criticVerdicts: count(finished.flatMap((v) => (v.critic ? [v.critic.verdict] : []))),
    flags: count(variants.flatMap((v) => v.flags)),
    pipelineMs: outcome.pipelineMs,
    pipelineCostUsd: outcome.pipelineCostUsd,
    judgeCostUsd: outcome.judgeCostUsd,
    expectations: { mustCiteMissing, forbiddenHits, requiredMissing, hookTypesDiffer },
  };
}

/** A case passes its expectations when nothing is missing, forbidden or equal. */
export const expectationsMet = (m: CaseMetrics): boolean =>
  m.expectations.mustCiteMissing.length === 0 &&
  m.expectations.forbiddenHits.length === 0 &&
  m.expectations.requiredMissing.length === 0 &&
  m.expectations.hookTypesDiffer;

export type Totals = {
  cases: number;
  casesMeetingExpectations: number;
  completionRate: number | null;
  schemaValidRate: number | null;
  citationCoverage: number | null;
  numericFidelityRate: number | null;
  differentiationFails: number;
  meanQualityScore: number | null;
  judge: { factualFidelity: number; localization: number; voice: number } | null;
  judgeUnsupportedClaims: number | null;
  /** Mean cost per case (= per idea), null when a run is not priced. */
  costPerIdeaUsd: number | null;
  meanPipelineMs: number | null;
};

/** The set's headline numbers: means over the cases that have the measure. */
export function aggregate(all: readonly CaseMetrics[]): Totals {
  const of = (pick: (m: CaseMetrics) => number | null) =>
    mean(
      all.flatMap((m) => {
        const v = pick(m);
        return v === null ? [] : [v];
      }),
    );
  const judged = all.flatMap((m) => (m.judge ? [m.judge] : []));
  const costs = all.map((m) =>
    m.pipelineCostUsd === null || m.judgeCostUsd === null
      ? null
      : m.pipelineCostUsd + m.judgeCostUsd,
  );
  return {
    cases: all.length,
    casesMeetingExpectations: all.filter(expectationsMet).length,
    completionRate: of((m) => m.completionRate),
    schemaValidRate: of((m) => m.schemaValidRate),
    citationCoverage: of((m) => m.citationCoverage),
    numericFidelityRate: of((m) => m.numericFidelityRate),
    differentiationFails: all.filter((m) => m.differentiation?.verdict === "FAIL").length,
    meanQualityScore: of((m) => m.meanQualityScore),
    judge:
      judged.length === 0
        ? null
        : {
            factualFidelity: mean(judged.map((j) => j.factualFidelity)) ?? 0,
            localization: mean(judged.map((j) => j.localization)) ?? 0,
            voice: mean(judged.map((j) => j.voice)) ?? 0,
          },
    judgeUnsupportedClaims: all.some((m) => m.judgeUnsupportedClaims !== null)
      ? all.reduce((n, m) => n + (m.judgeUnsupportedClaims ?? 0), 0)
      : null,
    costPerIdeaUsd: costs.some((c) => c === null) ? null : mean(costs as number[]),
    meanPipelineMs: mean(all.map((m) => m.pipelineMs)),
  };
}
