import type { MarketBrief } from "@rc/db/json";
import type { contentWriter, critic } from "@rc/prompts";

// Valid answers of the market adapter, the writer and the critic for two cards, shared by the tests
// of the variant pipeline and the fake model of the E2E server (M2-13, M2-14, M2-15). The plan of
// es-ES starts from the mistake, every other market from the myth, so the two never copy each other.

type Draft = contentWriter.ContentWriterOutput;
type Review = critic.CriticOutput;

/** A valid plan for es-ES (mistake first) or any other market (myth first): they differ. */
export function scriptedBrief(
  market: string,
  [card1, card2]: readonly [string, string],
): MarketBrief {
  const es = market === "es-ES";
  const plan = es
    ? ([
        ["HOOK", "A", []],
        ["MISTAKE", "E", [card1]],
        ["EXPLANATION", "B", [card1]],
        ["FACT", "B", [card2]],
        ["CTA", "F", []],
      ] as const)
    : ([
        ["HOOK", "A", []],
        ["FACT", "B", [card1]],
        ["EXPLANATION", "B", [card1]],
        ["STEP", "B", [card2]],
        ["SUMMARY", "B", [card2]],
        ["CTA", "F", []],
      ] as const);
  return {
    audienceFraming: es ? "Spanish home cooks." : "US home cooks.",
    terminology: [],
    substitutions: [],
    unitsPolicy: { system: es ? "METRIC" : "DUAL", conversions: [] },
    culturalHooks: [es ? "Arroz del domingo" : "Weeknight rice"],
    examples: [],
    tone: "Warm.",
    hookType: es ? "MISTAKE_CALLOUT" : "MYTH_BUST",
    slidePlan: plan.map(([role, templateId, knowledgeIds]) => ({
      role,
      templateId,
      purpose: `${role} slide`,
      knowledgeIds: [...knowledgeIds],
    })),
    ctaApproach: { ctaType: "SAVE" },
    risks: [],
    differentiationNotes: es ? "Mistake first." : "Myth first.",
  };
}

/** A draft that follows `scriptedBrief` and passes every validator; `tag` makes the texts differ. */
export function scriptedDraft(market: string, cards: readonly [string, string], tag = ""): Draft {
  const es = market === "es-ES";
  const b = scriptedBrief(market, cards);
  const text = (kind: string) => (es ? `Texto ${kind} ${tag}` : `Copy ${kind} ${tag}`).trim();
  const slotsFor = (templateId: string): { slot: string; text: string }[] =>
    templateId === "A"
      ? [{ slot: "headline", text: text("hook") }]
      : templateId === "E"
        ? [
            { slot: "mistakeTitle", text: text("error") },
            { slot: "mistakeText", text: text("mistake") },
            { slot: "correctTitle", text: text("fix") },
            { slot: "correctText", text: text("correct") },
          ]
        : templateId === "F"
          ? [
              { slot: "headline", text: text("cta") },
              { slot: "body", text: text("save it") },
            ]
          : [{ slot: "body", text: text("body") }];
  return {
    hook: text("hook"),
    hookType: b.hookType,
    slides: b.slidePlan.map((s) => ({
      role: s.role,
      templateId: s.templateId,
      slots: slotsFor(s.templateId),
      knowledgeIds: s.knowledgeIds,
      factual: s.knowledgeIds.length > 0,
      altText: "Rice.",
    })),
    caption: `${text("caption")}.`,
    cta: { type: "SAVE", text: text("save") },
    hashtags: ["#arroz", "#cocina", "#tecnica"],
    claimsUsed: [{ text: "A claim.", knowledgeIds: [cards[0]] }],
  };
}

export const scriptedReview = (over: Partial<Review> = {}): Review => ({
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
  issues: [],
  rewriteInstructions: "",
  humanAttention: "",
  ...over,
});
