import type { MarketBrief, Slide } from "@rc/db/json";
import type { contentWriter, critic, marketAdapter } from "@rc/prompts";
import { renderTemplateCatalog } from "@rc/templates";
import type { IdeaCard } from "../../knowledge/retrieval";
import { buildConversionTable, type NumberLocale, type NumericReference } from "../../localization";
import type { BriefValidationContext } from "../brief";
import type { ValidationContext } from "../validation";
import type { PipelineContext, PipelineMarket, PipelineOffer, PipelineVariant } from "./context";

// Builders of the stage inputs and validation contexts of one market (plan 07 §7.6.2): the data
// the pipeline loaded, in the shapes the prompts and the validators take.

type AdapterInput = marketAdapter.MarketAdapterInput;
type WriterInput = contentWriter.ContentWriterInput;
type WriterOutput = contentWriter.ContentWriterOutput;
type CriticInput = critic.CriticInput;

/** The language of the market's copy as a number locale: decimal comma for Spanish. */
export const numberLocale = (market: PipelineMarket): NumberLocale =>
  market.language === "es" ? "es-ES" : market.language === "ru" ? "ru" : "en";

type RawTiming = IdeaCard["timings"][number];
type RawIngredient = IdeaCard["ingredients"][number];

/** Drops `undefined` optionals (the localization helpers take exact optional properties). */
const timingsOf = (list: readonly RawTiming[]) =>
  list.map((t) => ({
    value: t.value,
    unit: t.unit,
    context: t.context,
    ...(t.valueMax !== undefined ? { valueMax: t.valueMax } : {}),
  }));
const ingredientsOf = (list: readonly RawIngredient[]) =>
  list.map((i) => ({
    name: i.name,
    ...(i.quantity !== undefined ? { quantity: i.quantity } : {}),
    ...(i.unit !== undefined ? { unit: i.unit } : {}),
    ...(i.note !== undefined ? { note: i.note } : {}),
  }));

const cardLocale = (language: string): NumberLocale =>
  language === "es" ? "es-ES" : language === "ru" ? "ru" : "en";

export type SiblingPlan = {
  marketCode: string;
  brief: MarketBrief;
};

export type SiblingDraft = { marketCode: string; hook: string; gist: string };

const marketProfile = (market: PipelineMarket) => ({
  code: market.code,
  displayName: market.displayName,
  language: market.language,
  toneNotes: market.toneNotes,
  foodCultureNotes: market.foodCultureNotes,
  preferredVocabulary: market.preferredVocabulary.map((v) => ({
    concept: v.concept,
    preferred: v.preferred,
    avoid: v.avoid ?? [],
    ...(v.note ? { note: v.note } : {}),
  })),
});

export const templatesForPrompt = (c: PipelineContext): WriterInput["templates"] =>
  c.templates.map((t) => ({
    id: t.id,
    roles: [...t.roles],
    textSlots: Object.entries(t.textSlots).map(([name, slot]) => ({
      name,
      maxChars: slot.maxChars,
      maxLines: slot.maxLines,
      required: slot.required,
    })),
  }));

/** One line of the conversion table per number of the cards, in the market's format. */
export function conversionLines(
  c: PipelineContext,
  market: PipelineMarket,
): AdapterInput["conversions"] {
  return c.cards.flatMap((card) =>
    buildConversionTable(
      {
        temperatures: card.temperatures,
        timings: timingsOf(card.timings),
        ingredients: ingredientsOf(card.ingredients),
      },
      { locale: numberLocale(market), measurementSystem: market.measurementSystem },
    ).map((entry) => ({ cardId: card.id, ...entry })),
  );
}

export function offerForPrompt(offer: PipelineOffer | undefined) {
  return offer
    ? { name: offer.name, type: offer.type, keyword: offer.defaultKeyword ?? null }
    : undefined;
}

export function adapterInput(
  c: PipelineContext,
  market: PipelineMarket,
  siblingPlans: readonly SiblingPlan[],
): AdapterInput {
  const offer = c.offers.get(market.id);
  return {
    idea: {
      topic: c.idea.topic,
      category: c.idea.category,
      angle: c.idea.angle,
      coreMessage: c.idea.coreMessage,
      evidenceSummary: c.idea.evidenceSummary,
      commercialIntent: c.idea.commercialIntent,
    },
    cards: c.cards.map((card) => ({
      id: card.id,
      version: card.version,
      language: card.language,
      role: card.role,
      title: card.title,
      category: card.category,
      claim: card.claim,
      explanation: card.explanation,
      procedure: card.procedure,
      ingredients: card.ingredients,
      temperatures: card.temperatures,
      timings: card.timings,
      commonMistakes: card.commonMistakes,
      safetySensitive: card.safetySensitive,
      safetyNotes: card.safetyNotes,
    })),
    market: {
      code: market.code,
      displayName: market.displayName,
      language: market.language,
      country: market.country,
      measurementSystem: market.measurementSystem,
      toneNotes: market.toneNotes,
      foodCultureNotes: market.foodCultureNotes,
      preferredVocabulary: marketProfile(market).preferredVocabulary,
      forbiddenPatterns: market.forbiddenPatterns,
    },
    ...(offer
      ? { offer: { name: offer.name, type: offer.type, defaultKeyword: offer.defaultKeyword } }
      : {}),
    conversions: conversionLines(c, market),
    siblingPlans: siblingPlans.map((s) => ({
      marketCode: s.marketCode,
      hookType: s.brief.hookType,
      audienceFraming: s.brief.audienceFraming,
      culturalHooks: s.brief.culturalHooks,
      slidePlan: s.brief.slidePlan.map(({ role, templateId, purpose }) => ({
        role,
        templateId,
        purpose,
      })),
    })),
    templateCatalog: renderTemplateCatalog(),
    templates: c.templates.map((t) => ({ id: t.id, roles: [...t.roles] })),
    taxonomy: { hookTypes: c.hookTypes, ctaTypes: c.ctaTypes },
  };
}

export function briefValidationContext(
  c: PipelineContext,
  market: PipelineMarket,
  siblings: readonly SiblingPlan[],
  templates: BriefValidationContext["templates"],
): BriefValidationContext {
  return {
    ideaKnowledgeIds: new Set(c.cards.map((card) => card.id)),
    primaryKnowledgeIds: new Set(
      c.cards.filter((card) => card.role === "PRIMARY").map((card) => card.id),
    ),
    templates,
    hookTypes: new Set(c.hookTypes.map((t) => t.code)),
    ctaTypes: new Set(c.ctaTypes.map((t) => t.code)),
    market: {
      measurementSystem: market.measurementSystem,
      forbiddenPatterns: market.forbiddenPatterns,
    },
    conversionDisplays: new Set(conversionLines(c, market).map((l) => l.display)),
    hasOffer: c.offers.has(market.id),
    siblings: siblings.map((s) => ({
      marketCode: s.marketCode,
      hookType: s.brief.hookType,
      slidePlan: s.brief.slidePlan,
    })),
  };
}

export function writerInput(
  c: PipelineContext,
  market: PipelineMarket,
  brief: MarketBrief,
  siblings: readonly SiblingDraft[],
  rewrite?: { instructions: string; previous: string },
): WriterInput {
  return {
    brandVoice: c.brandVoice,
    idea: {
      topic: c.idea.topic,
      coreMessage: c.idea.coreMessage,
      commercialIntent: c.idea.commercialIntent,
    },
    cards: c.cards.map((card) => ({
      id: card.id,
      version: card.version,
      language: card.language,
      role: card.role,
      title: card.title,
      claim: card.claim,
      explanation: card.explanation,
      procedure: card.procedure,
      commonMistakes: card.commonMistakes,
      safetySensitive: card.safetySensitive,
      safetyNotes: card.safetyNotes,
    })),
    market: {
      code: market.code,
      displayName: market.displayName,
      language: market.language,
      measurementSystem: market.measurementSystem,
      toneNotes: market.toneNotes,
      foodCultureNotes: market.foodCultureNotes,
      preferredVocabulary: marketProfile(market).preferredVocabulary,
      forbiddenPatterns: market.forbiddenPatterns,
    },
    brief,
    conversions: conversionLines(c, market),
    ...(offerForPrompt(c.offers.get(market.id))
      ? { offer: offerForPrompt(c.offers.get(market.id)) as NonNullable<WriterInput["offer"]> }
      : {}),
    templates: templatesForPrompt(c),
    siblingSummary: [...siblings],
    exemplars: c.exemplars.get(market.id) ?? [],
    taxonomy: {
      hookTypes: c.hookTypes.map(({ code, label }) => ({ code, label })),
      ctaTypes: c.ctaTypes.map(({ code, label }) => ({ code, label })),
    },
    ...(rewrite ? { rewrite } : {}),
  };
}

/** Everything the numeric-fidelity check may match a number in the copy against (07 §7.9.3). */
export function numericReference(c: PipelineContext): NumericReference {
  return {
    temperatures: c.cards.flatMap((card) => card.temperatures),
    timings: c.cards.flatMap((card) => timingsOf(card.timings)),
    ingredients: c.cards.flatMap((card) => ingredientsOf(card.ingredients)),
    texts: c.cards.flatMap((card) => [
      card.claim,
      card.explanation,
      ...card.procedure.map((p) => p.text),
      ...card.commonMistakes.flatMap((m) => [m.mistake, m.why ?? "", m.fix ?? ""]),
    ]),
    textLocale: cardLocale(c.cards[0]?.language ?? "ru"),
  };
}

export function validationContext(
  c: PipelineContext,
  market: PipelineMarket,
  templates: NonNullable<ValidationContext["templates"]>,
): ValidationContext {
  return {
    locale: numberLocale(market),
    forbiddenPatterns: market.forbiddenPatterns,
    ideaKnowledgeIds: new Set(c.cards.map((card) => card.id)),
    numericReference: numericReference(c),
    templates,
  };
}

export function criticInput(
  c: PipelineContext,
  market: PipelineMarket,
  brief: MarketBrief,
  draft: WriterOutput,
  siblings: readonly SiblingDraft[],
  deterministicIssues: CriticInput["deterministicIssues"],
  differentiation: CriticInput["differentiation"],
  iteration: number,
): CriticInput {
  return {
    brandVoice: c.brandVoice,
    idea: { topic: c.idea.topic, coreMessage: c.idea.coreMessage },
    cards: c.cards.map((card) => ({
      id: card.id,
      version: card.version,
      language: card.language,
      role: card.role,
      title: card.title,
      claim: card.claim,
      explanation: card.explanation,
      procedure: card.procedure,
      safetySensitive: card.safetySensitive,
      safetyNotes: card.safetyNotes,
    })),
    market: marketProfile(market),
    brief,
    draft,
    siblingSummary: [...siblings],
    deterministicIssues,
    ...(differentiation ? { differentiation } : {}),
    iteration,
  };
}

/** One line per slide of what it is for: the sibling gist the writer and critic read. */
export const gistOf = (brief: MarketBrief | null | undefined, hook: string): string =>
  brief
    ? `Hook type ${brief.hookType}; ${brief.slidePlan.map((s) => `${s.role}: ${s.purpose}`).join(" | ")}`
    : hook;

export const slidesText = (slides: readonly Slide[]) =>
  slides.map((s) => Object.values(s.slots).join(" ")).join(" ");

export type { PipelineVariant };
