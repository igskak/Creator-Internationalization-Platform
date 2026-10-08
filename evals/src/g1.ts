import type { EvalReport } from "./report";

// The part of Gate G1 (plan 14 §14.3) that numbers can decide. The rest (native reviewers' scores,
// "approvable with at most three edits") is human: the report only says it is still open.

export type G1Row = {
  criterion: string;
  status: "PASS" | "FAIL" | "HUMAN";
  detail: string;
};

const TEN_MINUTES_MS = 10 * 60 * 1000;
export const G1_MAX_COST_PER_IDEA_USD = 2;
export const G1_MIN_IDEAS = 10;

/** Machine-checkable G1 conditions from one eval report; HUMAN rows are left to the reviewers. */
export function g1Check(report: EvalReport): G1Row[] {
  const t = report.totals;
  const variants = report.cases.flatMap((c) => c.variants);
  const rows: G1Row[] = [];
  const row = (criterion: string, ok: boolean | null, detail: string) =>
    rows.push({ criterion, status: ok === null ? "HUMAN" : ok ? "PASS" : "FAIL", detail });

  row(
    "Input: 10 ideas × 2 markets",
    t.cases >= G1_MIN_IDEAS && variants.length >= G1_MIN_IDEAS * 2,
    `${t.cases} ideas, ${variants.length} variants (need ${G1_MIN_IDEAS} and ${G1_MIN_IDEAS * 2}). The cards must be real and approved.`,
  );
  row(
    "1a. Every factual slide cites an approved card",
    t.citationCoverage === 1,
    `citation coverage ${t.citationCoverage === null ? "–" : `${Math.round(t.citationCoverage * 100)}%`}`,
  );
  row(
    "1b. No numeric mismatch after the pipeline",
    t.numericFidelityRate === 1,
    `numeric fidelity ${t.numericFidelityRate === null ? "–" : `${Math.round(t.numericFidelityRate * 100)}%`}`,
  );
  const critic = report.cases.reduce((n, c) => n + c.metrics.criticUnsupportedClaims, 0);
  const judge = t.judgeUnsupportedClaims;
  row(
    "1c. No unsupported claim (critic and judge; a person confirms)",
    critic === 0 && (judge === null || judge === 0),
    `critic ${critic}, judge ${judge === null ? "not run (use --judge)" : judge}`,
  );
  row(
    "2. Native reviewers: reads as written for my market, mean ≥ 4.0, none below 3",
    null,
    "Blind sheet (`pnpm eval --blind`); the reviewers score it.",
  );
  row(
    "3a. No differentiation FAIL after the pipeline",
    t.differentiationFails === 0,
    `${t.differentiationFails} case(s) with a FAIL`,
  );
  row(
    "3b. At least 90 % of pairs judged not a translation of each other",
    null,
    "Blind sheet column `not_a_translation_of_the_other_yes_no`.",
  );
  row(
    "4. At least 70 % of variants approvable with at most 3 field edits",
    null,
    "Ihor and Sergey rate the drafts on the review screen.",
  );
  const slowest = Math.max(0, ...report.cases.map((c) => c.metrics.pipelineMs));
  row(
    "5a. One idea → 2 variants in at most 10 minutes",
    slowest <= TEN_MINUTES_MS,
    `slowest idea ${(slowest / 1000).toFixed(0)} s`,
  );
  row(
    `5b. Text cost per idea recorded and at most $${G1_MAX_COST_PER_IDEA_USD}`,
    t.costPerIdeaUsd !== null && t.costPerIdeaUsd <= G1_MAX_COST_PER_IDEA_USD,
    t.costPerIdeaUsd === null ? "not priced" : `$${t.costPerIdeaUsd.toFixed(2)} per idea`,
  );
  if (report.provider === "fake") {
    rows.push({
      criterion: "Provider",
      status: "FAIL",
      detail:
        "A fake run proves the harness, not the quality: G1 needs the live model and real cards.",
    });
  }
  return rows;
}

export function formatG1(rows: readonly G1Row[]): string {
  return [
    "Gate G1 (14 §14.3), the part numbers can check:",
    ...rows.map((r) => `  ${r.status.padEnd(5)} ${r.criterion} — ${r.detail}`),
  ].join("\n");
}
