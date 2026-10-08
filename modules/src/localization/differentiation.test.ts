import { createFakeEmbeddingProvider } from "@rc/lib/providers/embeddings";
import { describe, expect, it } from "vitest";
import {
  bestMatchSimilarity,
  cosine,
  DIFFERENTIATION_THRESHOLDS,
  type DifferentiationVariant,
  differentiateVariants,
  type EmbeddedVariant,
  levenshtein,
  scoreDifferentiation,
  sequenceSimilarity,
  slideText,
  worstReport,
} from "./differentiation";

// Cross-market differentiation (07 §7.10, M2-11). Synthetic texts only.

/** A unit vector at the angle whose cosine with [1, 0] is `c`. */
const withCosine = (c: number): number[] => [c, Math.sqrt(1 - c * c)];
const X = [1, 0];
const Y = [0, 1];

const embedded = (over: Partial<EmbeddedVariant> = {}): EmbeddedVariant => ({
  hook: X,
  slides: [X, Y],
  templates: ["A", "B", "B", "E", "F"],
  hookType: "MYTH_BUST",
  ...over,
});

describe("building blocks", () => {
  it("cosine is 0 for orthogonal or empty vectors and 1 for equal ones", () => {
    expect(cosine(X, Y)).toBe(0);
    expect(cosine(X, X)).toBeCloseTo(1);
    expect(cosine([], X)).toBe(0);
    expect(cosine(X, withCosine(0.6))).toBeCloseTo(0.6);
  });

  it("levenshtein counts inserts, deletes and replacements", () => {
    expect(levenshtein([], [])).toBe(0);
    expect(levenshtein(["A", "B"], ["A", "B"])).toBe(0);
    expect(levenshtein(["A", "B", "C"], ["A", "C"])).toBe(1);
    expect(levenshtein(["A", "B"], ["B", "A"])).toBe(2);
    expect(levenshtein(["A"], ["B", "C", "D"])).toBe(3);
  });

  it("template sequence similarity is 1 − distance / longer length", () => {
    expect(sequenceSimilarity(["A", "B", "F"], ["A", "B", "F"])).toBe(1);
    expect(sequenceSimilarity(["A", "B", "B", "E", "F"], ["A", "E", "B", "B", "F"])).toBeCloseTo(
      0.6,
    );
    expect(sequenceSimilarity(["A", "B"], ["C", "D", "E", "F"])).toBe(0);
    expect(sequenceSimilarity([], [])).toBe(1);
  });

  it("best-match similarity is symmetric and 0 without slides", () => {
    const a = [X, Y];
    const b = [X];
    expect(bestMatchSimilarity(a, b)).toBeCloseTo(bestMatchSimilarity(b, a));
    expect(bestMatchSimilarity(a, b)).toBeCloseTo((1 + 0.5) / 2 + 0 * 0, 1);
    expect(bestMatchSimilarity([], b)).toBe(0);
    expect(bestMatchSimilarity([X], [withCosine(-0.5)])).toBe(0);
  });

  it("joins slot texts in order, skipping blanks", () => {
    expect(slideText({ headline: " Hola ", body: "", note: "mundo" })).toBe("Hola mundo");
  });
});

describe("scoreDifferentiation (thresholds of 07 §7.10)", () => {
  const score = (a: Partial<EmbeddedVariant>, b: Partial<EmbeddedVariant>) =>
    scoreDifferentiation(embedded(a), embedded(b));
  const different = { hook: Y, slides: [Y], templates: ["A", "E", "F"], hookType: "CURIOSITY_GAP" };

  it("is OK for variants that share nothing", () => {
    const report = score({}, different);
    expect(report).toMatchObject({
      verdict: "OK",
      hookSimilarity: 0,
      sameHookType: false,
      reasons: [],
      thresholdsVersion: DIFFERENTIATION_THRESHOLDS.version,
    });
  });

  it("FAILs when the hooks are at least 0.90 alike, WARNs from 0.85", () => {
    expect(score({ hook: withCosine(0.9) }, { ...different, hook: X }).verdict).toBe("FAIL");
    expect(score({ hook: withCosine(0.89) }, { ...different, hook: X }).verdict).toBe("WARN");
    expect(score({ hook: withCosine(0.85) }, { ...different, hook: X }).verdict).toBe("WARN");
    expect(score({ hook: withCosine(0.84) }, { ...different, hook: X }).verdict).toBe("OK");
  });

  it("FAILs when the slide texts are at least 0.88 alike, WARNs from 0.82", () => {
    const slides = (c: number) => ({ slides: [withCosine(c)] });
    const base = { ...different, slides: [X] };
    expect(score(slides(0.88), base).verdict).toBe("FAIL");
    expect(score(slides(0.87), base).verdict).toBe("WARN");
    expect(score(slides(0.82), base).verdict).toBe("WARN");
    expect(score(slides(0.81), base).verdict).toBe("OK");
  });

  it("FAILs on the same template sequence with the same hook type, only WARNs otherwise", () => {
    const sameSeq = { ...different, templates: ["A", "B", "B", "E", "F"] };
    expect(score({}, { ...sameSeq, hookType: "MYTH_BUST" }).verdict).toBe("FAIL");
    const warned = score({}, { ...sameSeq, hookType: "CURIOSITY_GAP" });
    expect(warned.verdict).toBe("WARN");
    expect(warned.templateSequenceSimilarity).toBe(1);
    expect(warned.reasons).toEqual([expect.stringContaining("template sequences")]);
  });

  it("WARNs from a template sequence similarity of 0.8 and is OK below it", () => {
    const four = ["A", "B", "E", "F", "F"];
    expect(
      score({ templates: four }, { ...different, templates: ["A", "B", "E", "F", "B"] }).verdict,
    ).toBe("WARN");
    expect(
      score({ templates: four }, { ...different, templates: ["A", "B", "E", "B", "B"] }).verdict,
    ).toBe("OK");
  });

  it("lists every reason and the worst verdict wins", () => {
    const report = score(
      { hook: withCosine(0.92), slides: [X] },
      { ...different, hook: X, slides: [withCosine(0.84)] },
    );
    expect(report.verdict).toBe("FAIL");
    expect(report.reasons).toHaveLength(2);
  });

  it("compares image prompts only when both sides have them, and only warns", () => {
    expect(score({}, different).visualPromptSimilarity).toBeUndefined();
    const withVisuals = scoreDifferentiation(
      embedded({ visuals: [X] }),
      embedded({ ...different, visuals: [withCosine(0.95)] }),
    );
    expect(withVisuals.visualPromptSimilarity).toBeCloseTo(0.95, 2);
    expect(withVisuals.verdict).toBe("WARN");
    expect(withVisuals.reasons).toEqual([expect.stringContaining("image prompts")]);
  });

  it("uses the thresholds it is given and reports their version", () => {
    const strict = { ...DIFFERENTIATION_THRESHOLDS, version: "d2", hook: { warn: 0.1, fail: 0.2 } };
    const report = scoreDifferentiation(
      embedded({ hook: withCosine(0.3) }),
      embedded({ ...different, hook: X }),
      strict,
    );
    expect(report).toMatchObject({ verdict: "FAIL", thresholdsVersion: "d2" });
  });
});

describe("differentiateVariants with forced embeddings", () => {
  const variant = (
    marketCode: string,
    hook: string,
    texts: string[],
    over: Partial<DifferentiationVariant> = {},
  ): DifferentiationVariant => ({
    marketCode,
    hook,
    hookType: "MYTH_BUST",
    slides: texts.map((text, i) => ({ templateId: i === 0 ? "A" : "B", slots: { body: text } })),
    ...over,
  });
  const es = variant("es-ES", "Hook ES", ["ES one", "ES two", "ES three"]);

  it("FAILs a translation: forced-similar hooks and slides, same hook type and templates", async () => {
    const en = variant("en", "Hook EN", ["EN one", "EN two", "EN three"]);
    const provider = createFakeEmbeddingProvider({
      similar: [
        ["Hook ES", "Hook EN"],
        ["ES one", "EN one"],
        ["ES two", "EN two"],
        ["ES three", "EN three"],
      ],
    });
    const [pair] = await differentiateVariants(provider, [es, en]);
    expect(pair).toMatchObject({ a: "es-ES", b: "en" });
    expect(pair?.report.verdict).toBe("FAIL");
    expect(pair?.report.hookSimilarity).toBeGreaterThan(0.99);
    expect(pair?.report.slideTextSimilarity).toBeGreaterThan(0.99);
    expect(pair?.report.templateSequenceSimilarity).toBe(1);
    expect(pair?.report.sameHookType).toBe(true);
  });

  it("is OK for a true localization: unrelated texts, another hook type and structure", async () => {
    const en = variant("en", "Another hook", ["Other one", "Other two"], {
      hookType: "CURIOSITY_GAP",
      slides: [
        { templateId: "A", slots: { headline: "Other one" } },
        { templateId: "E", slots: { mistakeText: "Other two" } },
      ],
    });
    const [pair] = await differentiateVariants(createFakeEmbeddingProvider(), [es, en]);
    expect(pair?.report.verdict).toBe("OK");
    expect(pair?.report.hookSimilarity).toBeLessThan(0.3);
    expect(pair?.report.sameHookType).toBe(false);
  });

  it("FAILs on the same hook type and templates even when the words differ", async () => {
    const en = variant("en", "Another hook", ["Other one", "Other two", "Other three"]);
    const [pair] = await differentiateVariants(createFakeEmbeddingProvider(), [es, en]);
    expect(pair?.report.verdict).toBe("FAIL");
    expect(pair?.report.reasons).toEqual(["Same hook type and the same template sequence."]);
  });

  it("embeds all texts in one call and compares every pair", async () => {
    const provider = createFakeEmbeddingProvider();
    const en = variant("en", "Hook EN", ["EN one"], { hookType: "CURIOSITY_GAP" });
    const fr = variant("fr-FR", "Hook FR", ["FR one"], { hookType: "BOLD_CLAIM" });
    const pairs = await differentiateVariants(provider, [es, en, fr]);
    expect(pairs.map((p) => [p.a, p.b])).toEqual([
      ["es-ES", "en"],
      ["es-ES", "fr-FR"],
      ["en", "fr-FR"],
    ]);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.texts).toHaveLength(3 + 1 + 1 + 1 + 1 + 1);
  });

  it("needs two variants, skips blank slide texts and uses image prompts when both have them", async () => {
    expect(await differentiateVariants(createFakeEmbeddingProvider(), [es])).toEqual([]);
    const withBlank = variant("en", "Hook EN", ["EN one", "  "], {
      hookType: "CURIOSITY_GAP",
      visualPrompts: ["macro rice"],
    });
    const provider = createFakeEmbeddingProvider({
      similar: [["macro rice", "macro rice grains"]],
    });
    const other = { ...es, visualPrompts: ["macro rice grains"] };
    const [pair] = await differentiateVariants(provider, [other, withBlank]);
    expect(provider.calls[0]?.texts).not.toContain("");
    expect(pair?.report.visualPromptSimilarity).toBeGreaterThan(0.99);
  });

  it("picks the worst pair", async () => {
    const same = variant("en", "Hook EN", ["ES one", "ES two", "ES three"]);
    const far = variant("fr-FR", "Hook FR", ["FR one"], { hookType: "BOLD_CLAIM" });
    const pairs = await differentiateVariants(createFakeEmbeddingProvider(), [es, far, same]);
    expect(worstReport(pairs)?.report.verdict).toBe("FAIL");
    expect(worstReport([])).toBeUndefined();
  });
});
