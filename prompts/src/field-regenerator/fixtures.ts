import {
  FIXTURE_INPUT as WRITER_INPUT,
  FIXTURE_OUTPUT as WRITER_OUTPUT,
} from "../content-writer/fixtures";
import type { FieldRegeneratorInput, FieldRegeneratorOutput } from "./schema";

// Synthetic input and output for the tests and the fake LLM provider. Not real content.

const {
  brandVoice,
  idea,
  cards,
  market,
  brief,
  conversions,
  offer,
  templates,
  siblingSummary,
  taxonomy,
} = WRITER_INPUT;

export const FIXTURE_INPUT: FieldRegeneratorInput = {
  brandVoice,
  idea,
  cards,
  market,
  brief,
  conversions,
  ...(offer ? { offer } : {}),
  templates,
  siblingSummary,
  taxonomy,
  draft: {
    hook: WRITER_OUTPUT.hook,
    hookType: WRITER_OUTPUT.hookType,
    caption: WRITER_OUTPUT.caption,
    cta: WRITER_OUTPUT.cta,
    hashtags: WRITER_OUTPUT.hashtags,
    slides: WRITER_OUTPUT.slides.map((s, index) => ({
      id: `s${index + 1}`,
      index,
      role: s.role,
      templateId: s.templateId,
      slots: s.slots,
      knowledgeIds: s.knowledgeIds,
      factual: s.factual,
      altText: s.altText,
    })),
  },
  field: { path: "hook", kind: "hook" },
  instruction: "Shorter, and start with the verb.",
  reason: { code: "WEAK_HOOK", label: "Weak hook" },
};

export const FIXTURE_OUTPUT: FieldRegeneratorOutput = {
  field: "hook",
  value: "Deja de lavar el arroz del risotto.",
  rationale: "Starts with the verb and drops the second sentence.",
};
