import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generationVersion } from "@rc/modules/ai";
import {
  aggregate,
  type CaseMetrics,
  computeMetrics,
  expectationsMet,
  type Totals,
} from "./metrics";
import type { CaseOutcome } from "./runner";

// The results of an eval run: one JSON file (kept out of git: `evals/results/`) and a summary the
// terminal prints.

export type EvalReport = {
  set: string;
  startedAt: string;
  provider: "fake" | "live";
  model: string;
  judge: boolean;
  pipelineVersion: string;
  totals: Totals;
  cases: {
    id: string;
    description: string;
    metrics: CaseMetrics;
    meetsExpectations: boolean;
    failed: CaseOutcome["failed"];
    variants: {
      market: string;
      status: string;
      qualityScore: number | null;
      hook: string | null;
      hookType: string | null;
      flags: string[];
      criticVerdict: string | null;
      judge: CaseOutcome["judgements"][string] | null;
    }[];
  }[];
};

export function buildReport(
  outcomes: readonly CaseOutcome[],
  meta: Pick<EvalReport, "set" | "provider" | "model" | "judge"> & { startedAt?: string },
): EvalReport {
  const cases = outcomes.map((outcome) => {
    const metrics = computeMetrics(outcome);
    return {
      id: outcome.case.id,
      description: outcome.case.description,
      metrics,
      meetsExpectations: expectationsMet(metrics),
      failed: outcome.failed,
      variants: outcome.variants.map((v) => ({
        market: v.marketCode,
        status: v.status,
        qualityScore: v.qualityScore,
        hook: v.hook,
        hookType: v.hookType,
        flags: v.flags,
        criticVerdict: v.critic?.verdict ?? null,
        judge: outcome.judgements[v.marketCode] ?? null,
      })),
    };
  });
  return {
    set: meta.set,
    startedAt: meta.startedAt ?? new Date().toISOString(),
    provider: meta.provider,
    model: meta.model,
    judge: meta.judge,
    pipelineVersion: generationVersion(),
    totals: aggregate(cases.map((c) => c.metrics)),
    cases,
  };
}

export async function writeReport(report: EvalReport, resultsDir: string): Promise<string> {
  await mkdir(resultsDir, { recursive: true });
  const stamp = report.startedAt.replaceAll(":", "-").replace(/\..*$/, "");
  const file = join(resultsDir, `${stamp}-${report.set}-${report.provider}.json`);
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
  return file;
}

const pct = (x: number | null) => (x === null ? "–" : `${(x * 100).toFixed(0)}%`);
const num = (x: number | null, digits = 2) => (x === null ? "–" : x.toFixed(digits));

/** The summary the terminal shows after a run. */
export function summarize(report: EvalReport): string {
  const t = report.totals;
  const lines = [
    `Eval set "${report.set}" · ${report.provider} model ${report.model} · pipeline ${report.pipelineVersion}`,
    "",
    `cases meeting expectations   ${t.casesMeetingExpectations}/${t.cases}`,
    `variants completed           ${pct(t.completionRate)}`,
    `schema-valid runs            ${pct(t.schemaValidRate)}`,
    `citation coverage            ${pct(t.citationCoverage)}`,
    `numeric fidelity             ${pct(t.numericFidelityRate)}`,
    `differentiation FAIL cases   ${t.differentiationFails}`,
    `critic quality score (mean)  ${num(t.meanQualityScore)}`,
    ...(t.judge
      ? [
          `judge: factual / localization / voice   ${num(t.judge.factualFidelity)} / ${num(t.judge.localization)} / ${num(t.judge.voice)}`,
          `judge: unsupported claims    ${t.judgeUnsupportedClaims ?? "–"}`,
        ]
      : []),
    `cost per idea                ${t.costPerIdeaUsd === null ? "not priced" : `$${t.costPerIdeaUsd.toFixed(2)}`}${report.provider === "fake" ? " (tokens of the fake model are estimates)" : ""}`,
    `time per idea                ${t.meanPipelineMs === null ? "–" : `${(t.meanPipelineMs / 1000).toFixed(1)} s`}`,
    "",
  ];
  for (const c of report.cases) {
    const m = c.metrics;
    lines.push(
      `${c.meetsExpectations ? "ok  " : "FAIL"} ${c.id}  completed ${pct(m.completionRate)} · cited ${pct(m.citationCoverage)} · numbers ${pct(m.numericFidelityRate)} · compare ${m.differentiation?.verdict ?? "–"}`,
    );
    for (const f of c.failed) lines.push(`     failed ${f.marketCode}: ${f.code} ${f.message}`);
    for (const x of m.expectations.mustCiteMissing)
      lines.push(`     ${x.market}: does not cite "${x.key}"`);
    for (const x of m.expectations.forbiddenHits)
      lines.push(`     ${x.market}: contains "${x.phrase}"`);
    for (const x of m.expectations.requiredMissing)
      lines.push(`     ${x.market}: lacks "${x.text}"`);
    if (!m.expectations.hookTypesDiffer) lines.push("     the markets use the same hook type");
  }
  return lines.join("\n");
}
