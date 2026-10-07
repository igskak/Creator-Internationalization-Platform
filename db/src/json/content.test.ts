import { describe, expect, it } from "vitest";
import {
  BLOCKING_VARIANT_FLAGS,
  CriticReport,
  CtaSpec,
  DifferentiationReport,
  GenerationConfig,
  MarketBrief,
  PipelineState,
  Slide,
  UtmSpec,
  VARIANT_FLAGS,
  VariantFlag,
  VisualBrief,
} from "./content";

const slide = {
  id: "s1",
  index: 0,
  role: "HOOK",
  templateId: "A",
  slots: { headline: "Hello" },
  images: { background: {} },
  knowledgeIds: ["k1"],
  factual: true,
};

const scores = {
  factualFidelity: 5,
  sourceCoverage: 4,
  localization: 4,
  originality: 3,
  brandVoice: 4,
  structure: 5,
  cta: 4,
  overall: 4,
};

describe("content JSON shapes", () => {
  it("accepts a slide and rejects an unknown role or template", () => {
    expect(Slide.safeParse(slide).success).toBe(true);
    expect(Slide.safeParse({ ...slide, role: "OUTRO" }).success).toBe(false);
    expect(Slide.safeParse({ ...slide, templateId: "G" }).success).toBe(false);
    expect(Slide.safeParse({ ...slide, id: "" }).success).toBe(false);
    expect(Slide.safeParse({ ...slide, images: { bg: { assetId: "" } } }).success).toBe(false);
  });

  it("validates CTA and UTM specs", () => {
    expect(CtaSpec.safeParse({ type: "SAVE", text: "Save this" }).success).toBe(true);
    expect(CtaSpec.safeParse({ type: "DM_KEYWORD", text: "DM", linkMode: "EMAIL" }).success).toBe(
      false,
    );
    const utm = { source: "instagram", medium: "social", campaign: "c1", content: "v1" };
    expect(UtmSpec.safeParse(utm).success).toBe(true);
    expect(UtmSpec.safeParse({ ...utm, source: "tiktok" }).success).toBe(false);
  });

  it("validates a market brief", () => {
    const brief = {
      audienceFraming: "x",
      terminology: [],
      substitutions: [{ original: "a", local: "b", note: "", factualImpact: "NONE" }],
      unitsPolicy: { system: "DUAL", conversions: [{ from: "°C", to: "°F" }] },
      culturalHooks: [],
      examples: [],
      tone: "warm",
      hookType: "MYTH_BUST",
      slidePlan: [{ role: "HOOK", templateId: "A", purpose: "p", knowledgeIds: [] }],
      ctaApproach: { ctaType: "SAVE" },
      risks: [],
      differentiationNotes: "",
    };
    expect(MarketBrief.safeParse(brief).success).toBe(true);
    expect(
      MarketBrief.safeParse({ ...brief, unitsPolicy: { system: "SI", conversions: [] } }).success,
    ).toBe(false);
    expect(
      MarketBrief.safeParse({
        ...brief,
        substitutions: [{ original: "a", local: "b", note: "", factualImpact: "MAYBE" }],
      }).success,
    ).toBe(false);
  });

  it("validates a critic report with scores from 1 to 5", () => {
    const report = {
      verdict: "REQUEST_REWRITE",
      iteration: 1,
      scores,
      unsupportedClaims: [{ fieldPath: "slides.s1.slots.headline", text: "t", reason: "r" }],
      issues: [{ severity: "MAJOR", category: "LOCALIZATION", explanation: "e" }],
      rewriteInstructions: "shorten",
      deterministicIssues: [{ code: "SLOT_OVERFLOW", severity: "BLOCKER", message: "m" }],
    };
    expect(CriticReport.safeParse(report).success).toBe(true);
    expect(CriticReport.safeParse({ ...report, scores: { ...scores, cta: 0 } }).success).toBe(
      false,
    );
    expect(CriticReport.safeParse({ ...report, scores: { ...scores, cta: 5.5 } }).success).toBe(
      false,
    );
    expect(CriticReport.safeParse({ ...report, verdict: "MAYBE" }).success).toBe(false);
    expect(
      CriticReport.safeParse({
        ...report,
        deterministicIssues: [{ code: "X", severity: "FATAL", message: "m" }],
      }).success,
    ).toBe(false);
  });

  it("validates differentiation, generation config and pipeline state", () => {
    const diff = {
      hookSimilarity: 0.4,
      slideTextSimilarity: 0.2,
      templateSequenceSimilarity: 1,
      sameHookType: true,
      verdict: "WARN",
      reasons: ["same template sequence"],
      thresholdsVersion: "d1",
    };
    expect(DifferentiationReport.safeParse(diff).success).toBe(true);
    expect(DifferentiationReport.safeParse({ ...diff, hookSimilarity: 1.2 }).success).toBe(false);
    const config = {
      pipelineVersion: "p1.0.0",
      stages: { WRITER: { promptId: "w", promptVersion: 1, model: "m" } },
      embeddingModel: "e",
    };
    expect(GenerationConfig.safeParse(config).success).toBe(true);
    expect(
      GenerationConfig.safeParse({
        ...config,
        stages: { WRITER: { promptId: "w", promptVersion: 0, model: "m" } },
      }).success,
    ).toBe(false);
    const state = {
      pipelineRunId: "r",
      stage: "CRITIC",
      startedAt: "2026-10-07T10:00:00.000Z",
      completedStages: [],
      runIds: {},
    };
    expect(PipelineState.safeParse(state).success).toBe(true);
    expect(PipelineState.safeParse({ ...state, runIds: { a: 1 } }).success).toBe(false);
  });

  it("validates a visual brief", () => {
    const brief = {
      concept: "c",
      visualStyle: "CLEAN_STUDIO",
      slides: [
        { slideId: "s1", slot: "background", source: "GENERATE", composition: "x", aspect: "4:5" },
      ],
      differentiationFromSibling: "",
    };
    expect(VisualBrief.safeParse(brief).success).toBe(true);
    expect(
      VisualBrief.safeParse({
        ...brief,
        slides: [{ ...brief.slides[0], aspect: "2:1" }],
      }).success,
    ).toBe(false);
  });

  it("keeps the blocking flags inside the flag vocabulary", () => {
    for (const flag of BLOCKING_VARIANT_FLAGS) expect(VARIANT_FLAGS).toContain(flag);
    expect(BLOCKING_VARIANT_FLAGS).not.toContain("KNOWLEDGE_CHANGED");
    expect(VariantFlag.safeParse("KNOWLEDGE_ARCHIVED").success).toBe(true);
    expect(VariantFlag.safeParse("SOMETHING").success).toBe(false);
  });
});
