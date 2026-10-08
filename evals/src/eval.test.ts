import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { exportBlind } from "./blind";
import { EvalCase, loadCases } from "./case";
import { describeEstimate, estimateRun } from "./cost";
import { createFakeEvalEmbeddings, createFakeEvalModel } from "./fake-model";
import { PACKAGE_NAME } from "./index";
import { aggregate, computeMetrics, expectationsMet } from "./metrics";
import { buildReport, summarize, writeReport } from "./report";
import { type CaseOutcome, runCase } from "./runner";

// The eval harness (M2-16): the case format, the metrics, the blind export and a whole run with the
// fake model on the synthetic set. Nothing here calls a paid API.

const SET = fileURLToPath(new URL("../sets/synthetic", import.meta.url));

describe("case format", () => {
  it("loads the synthetic set: three valid cases in name order", async () => {
    const cases = await loadCases(SET);
    expect(cases.map((c) => c.id)).toEqual([
      "buckwheat-lid",
      "rice-not-rinsed",
      "rice-storage-safety",
    ]);
    expect(cases.every((c) => c.markets.join() === "es-ES,en")).toBe(true);
    expect(PACKAGE_NAME).toBe("@rc/evals");
  });

  const base = {
    id: "x",
    idea: { topic: "t", category: "C", angle: "A", coreMessage: "m" },
    cards: [{ key: "a", title: "t", category: "C", claim: "c" }],
  };

  it("fills the defaults and rejects a bad id, duplicate keys, no primary card and an unknown mustCite", () => {
    const ok = EvalCase.parse(base);
    expect(ok).toMatchObject({
      markets: ["es-ES", "en"],
      expect: { hookTypesDiffer: true, mustCite: [] },
    });
    expect(ok.cards[0]).toMatchObject({ role: "PRIMARY", language: "ru", safetySensitive: false });
    expect(EvalCase.safeParse({ ...base, id: "Bad Id" }).success).toBe(false);
    expect(EvalCase.safeParse({ ...base, cards: [base.cards[0], base.cards[0]] }).success).toBe(
      false,
    );
    expect(
      EvalCase.safeParse({ ...base, cards: [{ ...base.cards[0], role: "SUPPORTING" }] }).success,
    ).toBe(false);
    expect(EvalCase.safeParse({ ...base, expect: { mustCite: ["nope"] } }).success).toBe(false);
    expect(EvalCase.safeParse({ ...base, cards: [] }).success).toBe(false);
  });

  it("names the file of a bad case and refuses two cases with one id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eval-set-"));
    await mkdir(join(dir, "cases"));
    await writeFile(join(dir, "cases", "a.json"), JSON.stringify({ ...base, cards: [] }));
    await expect(loadCases(dir)).rejects.toThrow(/^a\.json: cards/);
    await writeFile(join(dir, "cases", "a.json"), JSON.stringify(base));
    await writeFile(join(dir, "cases", "b.json"), JSON.stringify(base));
    await expect(loadCases(dir)).rejects.toThrow('Two cases have the id "x".');
  });
});

describe("cost preview", () => {
  it("counts the calls and prices them, with the judge adding one call per market", async () => {
    const cases = await loadCases(SET);
    const plain = estimateRun(cases, { judge: false });
    const judged = estimateRun(cases, { judge: true });
    expect(plain.calls).toBe(18); // 3 cases × 2 markets × (plan, draft, review)
    expect(judged.calls).toBe(24);
    expect(plain.typicalUsd).toBeGreaterThan(0);
    expect(plain.worstCaseUsd).toBeGreaterThan(plain.typicalUsd ?? 0);
    expect(judged.typicalUsd).toBeGreaterThan(plain.typicalUsd ?? 0);
    expect(describeEstimate(plain, "claude-opus-5-5")).toMatch(
      /^18 model calls with claude-opus-5-5: about \$\d/,
    );
    expect(
      describeEstimate({ calls: 3, typicalUsd: null, worstCaseUsd: null }, "mystery"),
    ).toContain("no price");
  });
});

describe("a run with the fake model on the synthetic set", () => {
  const run = async (judge: boolean) => {
    const outcomes: CaseOutcome[] = [];
    for (const evalCase of await loadCases(SET)) {
      outcomes.push(
        await runCase(evalCase, {
          llm: createFakeEvalModel(),
          embeddings: createFakeEvalEmbeddings(),
          judge,
        }),
      );
    }
    return outcomes;
  };

  it("finishes every draft, meets every expectation and reports the metrics", async () => {
    const outcomes = await run(true);
    expect(outcomes.flatMap((o) => o.failed)).toEqual([]);
    for (const outcome of outcomes) {
      expect(outcome.variants.map((v) => v.status)).toEqual([
        "READY_FOR_REVIEW",
        "READY_FOR_REVIEW",
      ]);
      const m = computeMetrics(outcome);
      expect(m).toMatchObject({
        completionRate: 1,
        schemaValidRate: 1,
        citationCoverage: 1,
        numericFidelityRate: 1,
        criticUnsupportedClaims: 0,
        judgeUnsupportedClaims: 0,
        judge: { factualFidelity: 5, localization: 4, voice: 4 },
        differentiation: { verdict: "OK" },
        rewrites: 0,
        criticVerdicts: { PASS: 2 },
      });
      expect(m.meanQualityScore).toBe(4.42);
      expect(expectationsMet(m)).toBe(true);
      expect(outcome.judgements["es-ES"]).toMatchObject({ scores: { factualFidelity: 5 } });
    }
    const report = buildReport(outcomes, {
      set: "synthetic",
      provider: "fake",
      model: "scripted",
      judge: true,
    });
    expect(report.totals).toMatchObject({
      cases: 3,
      casesMeetingExpectations: 3,
      completionRate: 1,
      differentiationFails: 0,
      judge: { factualFidelity: 5, localization: 4, voice: 4 },
    });
    expect(report.pipelineVersion).toBe("p1.0.0");
    expect(summarize(report)).toContain("cases meeting expectations   3/3");

    const dir = await mkdtemp(join(tmpdir(), "eval-out-"));
    const file = await writeReport(report, dir);
    expect(file).toMatch(/synthetic-fake\.json$/);
    expect(JSON.parse(await readFile(file, "utf8")).totals.cases).toBe(3);
  }, 120_000);

  it("runs without the judge and then has no judge numbers", async () => {
    const [first] = await loadCases(SET);
    const outcome = await runCase(first as EvalCase, {
      llm: createFakeEvalModel(),
      embeddings: createFakeEvalEmbeddings(),
      judge: false,
    });
    expect(outcome.judgements).toEqual({});
    expect(computeMetrics(outcome).judge).toBeNull();
    expect(aggregate([computeMetrics(outcome)]).judge).toBeNull();
  }, 60_000);

  it("fails the expectations that are not met: a missing citation, a forbidden phrase, a missing text, equal hook types", async () => {
    const [first] = await loadCases(SET);
    const strict = EvalCase.parse({
      ...first,
      expect: {
        mustCite: ["lid"],
        forbiddenPhrases: [
          { phrases: ["Texto hook"] },
          { market: "en", phrases: ["COPY CAPTION"] },
        ],
        requiredText: [{ market: "es-ES", text: "180 °C" }],
        hookTypesDiffer: true,
      },
    });
    const outcome = await runCase(strict, {
      llm: createFakeEvalModel(),
      embeddings: createFakeEvalEmbeddings(),
      judge: false,
    });
    const m = computeMetrics(outcome);
    expect(m.expectations.forbiddenHits).toEqual([
      { market: "es-ES", phrase: "Texto hook" },
      { market: "en", phrase: "COPY CAPTION" },
    ]);
    expect(m.expectations.requiredMissing).toEqual([{ market: "es-ES", text: "180 °C" }]);
    expect(m.expectations.mustCiteMissing).toEqual([]); // the one card is cited
    expect(expectationsMet(m)).toBe(false);
    expect(
      summarize(buildReport([outcome], { set: "s", provider: "fake", model: "m", judge: false })),
    ).toContain('es-ES: lacks "180 °C"');
  }, 60_000);
});

describe("blind export", () => {
  it("gives each idea two items A and B without the market, plus a key and a sheet", async () => {
    const [first, second] = await loadCases(SET);
    const outcomes: CaseOutcome[] = [];
    for (const evalCase of [first, second] as EvalCase[]) {
      outcomes.push(
        await runCase(evalCase, {
          llm: createFakeEvalModel(),
          embeddings: createFakeEvalEmbeddings(),
          judge: false,
        }),
      );
    }
    const sheet = exportBlind(outcomes, "seed-1");
    expect(Object.keys(sheet.key)).toEqual(["buckwheat-lid", "rice-not-rinsed"]);
    for (const labels of Object.values(sheet.key)) {
      expect(Object.keys(labels)).toEqual(["A", "B"]);
      expect(Object.values(labels).sort()).toEqual(["en", "es-ES"]);
    }
    // No market code, quality score or critic text on the sheet the reviewers get.
    expect(sheet.markdown).not.toMatch(/es-ES|Quality|critic/i);
    expect(sheet.markdown.match(/### Draft [AB]/g)).toHaveLength(4);
    const rows = sheet.csv.trim().split("\n");
    expect(rows[0]).toBe(
      "case_id,item,language,reads_as_native_1_5,not_a_translation_of_the_other_yes_no,approvable_yes_no,field_edits_needed,comments",
    );
    expect(rows).toHaveLength(5);
    expect(rows[1]).toMatch(/^buckwheat-lid,A,(es|en),,,,,$/);
    // The same seed gives the same order; the order is a function of the seed and the case.
    expect(exportBlind(outcomes, "seed-1").key).toEqual(sheet.key);
    const orders = new Set(
      ["a", "b", "c", "d", "e", "f"].map((s) =>
        JSON.stringify(exportBlind(outcomes, s).key["rice-not-rinsed"]),
      ),
    );
    expect(orders.size).toBe(2);
  }, 90_000);

  it("skips an idea that has fewer than two drafts", async () => {
    const [first] = await loadCases(SET);
    const outcome = await runCase(first as EvalCase, {
      llm: createFakeEvalModel(),
      embeddings: createFakeEvalEmbeddings(),
      judge: false,
    });
    const one = { ...outcome, variants: outcome.variants.slice(0, 1) };
    expect(exportBlind([one]).key).toEqual({});
  }, 60_000);
});
