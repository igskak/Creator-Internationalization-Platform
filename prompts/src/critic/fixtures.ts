import { FIXTURE_OUTPUT as DRAFT, FIXTURE_INPUT as WRITER_INPUT } from "../content-writer/fixtures";
import type { CriticInput, CriticOutput } from "./schema";

// Synthetic input and output for the tests and the fake LLM provider. Not Reg.Chef content.

export const FIXTURE_INPUT: CriticInput = {
  brandVoice: WRITER_INPUT.brandVoice,
  idea: { topic: WRITER_INPUT.idea.topic, coreMessage: WRITER_INPUT.idea.coreMessage },
  cards: WRITER_INPUT.cards.map((c) => ({
    id: c.id,
    version: c.version,
    language: c.language,
    role: c.role,
    title: c.title,
    claim: c.claim,
    explanation: c.explanation,
    procedure: c.procedure,
    safetySensitive: c.safetySensitive,
    safetyNotes: c.safetyNotes,
  })),
  market: {
    code: WRITER_INPUT.market.code,
    displayName: WRITER_INPUT.market.displayName,
    language: WRITER_INPUT.market.language,
    toneNotes: WRITER_INPUT.market.toneNotes,
    foodCultureNotes: WRITER_INPUT.market.foodCultureNotes,
    preferredVocabulary: WRITER_INPUT.market.preferredVocabulary,
  },
  brief: WRITER_INPUT.brief,
  draft: DRAFT,
  siblingSummary: WRITER_INPUT.siblingSummary,
  deterministicIssues: [
    {
      code: "HASHTAG_COUNT",
      severity: "MAJOR",
      fieldPath: "hashtags",
      message: "2 hashtags, the policy is 3–5.",
    },
  ],
  differentiation: {
    verdict: "OK",
    hookSimilarity: 0.21,
    slideTextSimilarity: 0.34,
    reasons: [],
  },
  iteration: 0,
};

/** A passing review. */
export const FIXTURE_OUTPUT: CriticOutput = {
  verdict: "PASS",
  scores: {
    factualFidelity: 5,
    sourceCoverage: 4,
    localization: 4,
    originality: 5,
    brandVoice: 4,
    structure: 5,
    cta: 4,
    overall: 4,
  },
  unsupportedClaims: [],
  issues: [
    {
      severity: "MINOR",
      category: "LOCALIZATION",
      fieldPath: "slides.2.slots.headline",
      explanation: "“Dónde está el truco” is a little informal for the brand voice.",
      suggestedFix: "“Qué hace el almidón”.",
    },
  ],
  rewriteInstructions: "",
  humanAttention: "",
};
