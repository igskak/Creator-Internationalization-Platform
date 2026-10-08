import type { AnyDatabase } from "@rc/db";
import { schema } from "@rc/db";
import type { MarketBrief, RightsPolicy } from "@rc/db/json";
import { EMBEDDING_DIMENSIONS } from "@rc/lib/providers/embeddings";
import type { StructuredRequest } from "@rc/lib/providers/llm";
import type { contentWriter, critic } from "@rc/prompts";

// A scripted model and an accepted idea for the tests of the variant pipeline (M2-13, M2-14):
// one valid plan, draft and review per market, built from the ids of two seeded cards.

type Draft = contentWriter.ContentWriterOutput;
type Review = critic.CriticOutput;

const rights: RightsPolicy = {
  use: "ALLOWED",
  translate: "ALLOWED",
  adapt: "ALLOWED",
  visuallyTransform: "UNKNOWN",
  sell: "UNKNOWN",
  aiProcessing: "ALLOWED",
  improvePrompts: "UNKNOWN",
};
const axis = (i: number) => {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  v[i % EMBEDDING_DIMENSIONS] = 1;
  return v;
};
const snapshot = (title: string, claim: string) => ({
  title,
  category: "GRAINS_RICE_PASTA",
  subcategory: null,
  claim,
  explanation: "",
  procedure: [],
  ingredients: [],
  temperatures: [],
  timings: [],
  commonMistakes: [],
  sourceReference: null,
  language: "ru",
  safetySensitive: false,
  safetyNotes: null,
  tags: [],
});

export const textOfRequest = (request: StructuredRequest<unknown>): string =>
  request.messages
    .flatMap((m) => m.content)
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("\n");

/** The market a rendered request is about. */
export const marketOfRequest = (request: StructuredRequest<unknown>): string =>
  /<market_profile code="([^"]+)"/.exec(textOfRequest(request))?.[1] ?? "";

export type SeededIdea = { brandId: string; card1: string; card2: string; ideaId: string };

/** Two approved cards (with approved versions) and an ACCEPTED idea linking both. */
export async function seedAcceptedIdea(db: AnyDatabase): Promise<SeededIdea> {
  const [brand] = await db.select().from(schema.brands);
  const brandId = brand?.id ?? "";
  await db.update(schema.brands).set({ brandVoice: "Warm and precise." });
  const [source] = await db
    .insert(schema.sourceAssets)
    .values({ brandId, type: "GUIDE", title: "g", originalLanguage: "ru", rights })
    .returning();
  const cards: string[] = [];
  for (const [i, claim] of ["Рис не промывают.", "Две части воды на одну."].entries()) {
    const [row] = await db
      .insert(schema.knowledgeItems)
      .values({
        brandId,
        title: `Карточка ${i + 1}`,
        category: "GRAINS_RICE_PASTA",
        claim,
        language: "ru",
        origin: "SOURCE_EXTRACTED",
        reviewStatus: "CHEF_APPROVED",
        version: 1,
        approvedVersion: 1,
        approvedAt: new Date(),
        sourceAssetId: source?.id ?? null,
        embedding: axis(i + 1),
        embeddingModel: "fake-embedding",
      })
      .returning();
    await db.insert(schema.knowledgeItemVersions).values({
      knowledgeItemId: row?.id ?? "",
      version: 1,
      status: "CHEF_APPROVED",
      snapshot: snapshot(`Карточка ${i + 1}`, claim),
    });
    cards.push(row?.id ?? "");
  }
  const [card1, card2] = cards as [string, string];
  const [idea] = await db
    .insert(schema.masterIdeas)
    .values({
      brandId,
      topic: "Rice",
      category: "GRAINS_RICE_PASTA",
      angle: "COMMON_MISTAKE",
      coreMessage: "Do not rinse risotto rice.",
      status: "ACCEPTED",
      origin: "MANUAL",
    })
    .returning();
  const ideaId = idea?.id ?? "";
  await db.insert(schema.masterIdeaKnowledge).values([
    { masterIdeaId: ideaId, knowledgeItemId: card1, knowledgeVersion: 1, role: "PRIMARY" },
    { masterIdeaId: ideaId, knowledgeItemId: card2, knowledgeVersion: 1, role: "SUPPORTING" },
  ]);
  return { brandId, card1, card2, ideaId };
}

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
