import {
  FIXTURE_INPUT as ADAPTER_INPUT,
  FIXTURE_OUTPUT as BRIEF,
} from "../market-adapter/fixtures";
import type { ContentWriterInput, ContentWriterOutput } from "./schema";

// Synthetic input and output for the tests and the fake LLM provider. Not Reg.Chef content.

export const FIXTURE_INPUT: ContentWriterInput = {
  brandVoice: "# Voz\nCercana, clara y precisa. Sin dramatismo.",
  idea: {
    topic: ADAPTER_INPUT.idea.topic,
    coreMessage: ADAPTER_INPUT.idea.coreMessage,
    commercialIntent: "LEAD_MAGNET",
  },
  cards: ADAPTER_INPUT.cards.map((c) => ({
    id: c.id,
    version: c.version,
    language: c.language,
    role: c.role,
    title: c.title,
    claim: c.claim,
    explanation: c.explanation,
    procedure: c.procedure,
    commonMistakes: c.commonMistakes,
    safetySensitive: c.safetySensitive,
    safetyNotes: c.safetyNotes,
  })),
  market: {
    code: ADAPTER_INPUT.market.code,
    displayName: ADAPTER_INPUT.market.displayName,
    language: ADAPTER_INPUT.market.language,
    measurementSystem: "METRIC",
    toneNotes: ADAPTER_INPUT.market.toneNotes,
    foodCultureNotes: ADAPTER_INPUT.market.foodCultureNotes,
    preferredVocabulary: ADAPTER_INPUT.market.preferredVocabulary,
    forbiddenPatterns: ADAPTER_INPUT.market.forbiddenPatterns,
  },
  brief: BRIEF,
  conversions: ADAPTER_INPUT.conversions,
  offer: { name: "Guía de cereales", type: "LEAD_MAGNET", keyword: "ARROZ" },
  templates: [
    {
      id: "A",
      roles: ["HOOK"],
      textSlots: [
        { name: "kicker", maxChars: 24, maxLines: 1, required: false },
        { name: "headline", maxChars: 70, maxLines: 3, required: true },
        { name: "subline", maxChars: 90, maxLines: 2, required: false },
      ],
    },
    {
      id: "B",
      roles: ["FACT", "EXPLANATION", "STEP", "SUMMARY", "PROBLEM"],
      textSlots: [
        { name: "number", maxChars: 8, maxLines: 1, required: false },
        { name: "label", maxChars: 40, maxLines: 1, required: false },
        { name: "headline", maxChars: 60, maxLines: 2, required: false },
        { name: "body", maxChars: 220, maxLines: 6, required: true },
      ],
    },
    {
      id: "E",
      roles: ["MISTAKE", "CORRECT"],
      textSlots: [
        { name: "mistakeTitle", maxChars: 40, maxLines: 1, required: true },
        { name: "mistakeText", maxChars: 140, maxLines: 4, required: true },
        { name: "correctTitle", maxChars: 40, maxLines: 1, required: true },
        { name: "correctText", maxChars: 140, maxLines: 4, required: true },
      ],
    },
    {
      id: "F",
      roles: ["CTA"],
      textSlots: [
        { name: "headline", maxChars: 60, maxLines: 2, required: true },
        { name: "body", maxChars: 160, maxLines: 4, required: true },
        { name: "keyword", maxChars: 16, maxLines: 1, required: false },
        { name: "offerName", maxChars: 40, maxLines: 1, required: false },
      ],
    },
  ],
  siblingSummary: [
    {
      marketCode: "en",
      hook: "Stop rinsing your rice.",
      gist: "Myth first, then starch, then toasting; ends with a save.",
    },
  ],
  exemplars: [
    {
      kind: "EXEMPLAR",
      text: "El secreto del arroz meloso no está en el caldo, está en el grano.",
    },
    {
      kind: "EDIT_PAIR",
      before: "Descubre el truco",
      after: "Deja de lavar el arroz",
      note: "WEAK_HOOK",
    },
    { kind: "RULE", text: "Frases cortas. Un solo dato por diapositiva." },
  ],
  taxonomy: ADAPTER_INPUT.taxonomy,
};

/** A draft that passes the validators for FIXTURE_INPUT. */
export const FIXTURE_OUTPUT: ContentWriterOutput = {
  hook: "Lavas el arroz del risotto. Ese es el error.",
  hookType: "MISTAKE_CALLOUT",
  slides: [
    {
      role: "HOOK",
      templateId: "A",
      slots: [{ slot: "headline", text: "Lavas el arroz del risotto. Ese es el error." }],
      knowledgeIds: [],
      factual: false,
      altText: "Un bol de arroz arborio seco.",
    },
    {
      role: "MISTAKE",
      templateId: "E",
      slots: [
        { slot: "mistakeTitle", text: "Error" },
        { slot: "mistakeText", text: "Lavar el arroz antes de cocinarlo." },
        { slot: "correctTitle", text: "Mejor" },
        {
          slot: "correctText",
          text: "Usarlo seco: el almidón de la superficie es lo que da cremosidad.",
        },
      ],
      knowledgeIds: ["card-rice-1"],
      factual: true,
      altText: "Arroz en un colador bajo el grifo.",
    },
    {
      role: "EXPLANATION",
      templateId: "B",
      slots: [
        { slot: "headline", text: "Dónde está el truco" },
        {
          slot: "body",
          text: "El almidón pasa al caldo y lo espesa. Si lo lavas, se va por el desagüe.",
        },
      ],
      knowledgeIds: ["card-rice-1"],
      factual: true,
      altText: "Caldo espesándose en la sartén.",
    },
    {
      role: "FACT",
      templateId: "B",
      slots: [
        { slot: "headline", text: "Y para el arroz suelto" },
        {
          slot: "body",
          text: "Con arroz de grano largo, usa dos partes de agua por una de arroz.",
        },
      ],
      knowledgeIds: ["card-rice-2"],
      factual: true,
      altText: "Medidor con arroz y agua.",
    },
    {
      role: "CTA",
      templateId: "F",
      slots: [
        { slot: "headline", text: "Más técnicas de arroz" },
        { slot: "body", text: "Comenta ARROZ y te mando la guía de cereales." },
        { slot: "keyword", text: "ARROZ" },
      ],
      knowledgeIds: [],
      factual: false,
      altText: "Portada de la guía de cereales.",
    },
  ],
  caption:
    "Lavas el arroz del risotto. Ese es el error.\n\nEl almidón de la superficie es lo que espesa el caldo y hace el plato meloso. Cocínalo seco y notarás la diferencia.\n\nComenta ARROZ y te mando la guía de cereales.",
  cta: {
    type: "COMMENT_KEYWORD",
    text: "Comenta ARROZ y te mando la guía de cereales.",
    keyword: "ARROZ",
  },
  hashtags: ["#risotto", "#arroz", "#tecnicasdecocina"],
  claimsUsed: [
    {
      text: "El arroz de risotto no se lava porque el almidón de la superficie lo hace cremoso.",
      knowledgeIds: ["card-rice-1"],
    },
    {
      text: "Para arroz de grano largo suelto, dos partes de agua por una de arroz.",
      knowledgeIds: ["card-rice-2"],
    },
  ],
};
