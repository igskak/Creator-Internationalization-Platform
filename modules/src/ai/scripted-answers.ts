import type { MarketBrief, VisualBrief } from "@rc/db/json";
import type { contentWriter, critic } from "@rc/prompts";

// Valid answers of the market adapter, the writer and the critic for two cards, shared by the tests
// of the variant pipeline and the fake model of the E2E server (M2-13, M2-14, M2-15). The plan of
// es-ES starts from the mistake, every other market from the myth, so the two never copy each other.

type Draft = contentWriter.ContentWriterOutput;
type Review = critic.CriticAnswer;

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
    hook: 4,
    overall: 4,
  },
  unsupportedClaims: [],
  issues: [],
  rewriteInstructions: "",
  humanAttention: "",
  ...over,
});

/**
 * A valid visual brief for a rendered visual-director request: every image slot of the slides gets
 * a generated picture (so the required ones are covered), the first style is used, and the
 * composition names the market so that two markets never look the same.
 */
export function scriptedVisualBrief(requestText: string): VisualBrief {
  const market = /<market code="([^"]+)"/u.exec(requestText)?.[1] ?? "";
  const style = /<style code="([^"]+)"/u.exec(requestText)?.[1] ?? "";
  const slides: VisualBrief["slides"] = [];
  for (const slide of requestText.matchAll(/<slide id="([^"]+)"[^>]*>([\s\S]*?)<\/slide>/gu)) {
    for (const slot of (slide[2] ?? "").matchAll(
      /<image_slot name="([^"]+)" aspect="([^"]+)" required="(true|false)"/gu,
    )) {
      const aspect = (["4:5", "1:1", "3:4", "16:9"] as const).find((a) => a === slot[2]) ?? "4:5";
      slides.push({
        slideId: slide[1] ?? "",
        slot: slot[1] ?? "",
        source: "GENERATE",
        prompt: `Macro photo of rice grains in a bowl, soft side light, ${market} mood`,
        negativePrompt: "text, logos, packaging, clutter",
        composition: `Subject low in the frame, empty space above (${market}).`,
        aspect,
      });
    }
  }
  return {
    concept: `Scripted concept for ${market}.`,
    visualStyle: style,
    slides,
    differentiationFromSibling: "",
  };
}
