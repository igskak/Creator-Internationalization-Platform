import type { MarketAdapterInput, MarketAdapterOutput } from "./schema";

// Synthetic input and output for the tests and the fake LLM provider. Not Reg.Chef content.

export const FIXTURE_INPUT: MarketAdapterInput = {
  idea: {
    topic: "Why risotto rice is never rinsed",
    category: "GRAINS_RICE_PASTA",
    angle: "MYTH_VS_FACT",
    coreMessage: "Rinsing risotto rice washes away the surface starch that makes it creamy.",
    evidenceSummary:
      "Card 1 states the starch effect; card 2 gives the water ratio for long-grain rice.",
    commercialIntent: "LEAD_MAGNET",
  },
  cards: [
    {
      id: "card-rice-1",
      version: 2,
      language: "ru",
      role: "PRIMARY",
      title: "Промывка риса",
      category: "GRAINS_RICE_PASTA",
      claim: "Рис для ризотто не промывают: крахмал на поверхности зерна делает блюдо кремовым.",
      explanation: "Крахмал переходит в бульон и загущает его.",
      procedure: [{ n: 1, text: "Обжарьте сухой рис в масле две минуты." }],
      ingredients: [{ name: "рис арборио", quantity: 300, unit: "г" }],
      temperatures: [{ value: 180, unit: "C", target: "oven", context: "духовка" }],
      timings: [{ value: 18, valueMax: 20, unit: "min", context: "варка" }],
      commonMistakes: [{ mistake: "Промывать рис", why: "теряется крахмал", fix: "Не промывать" }],
      safetySensitive: false,
      safetyNotes: null,
    },
    {
      id: "card-rice-2",
      version: 1,
      language: "ru",
      role: "SUPPORTING",
      title: "Соотношение воды и риса",
      category: "GRAINS_RICE_PASTA",
      claim: "Для рассыпчатого длиннозёрного риса берут две части воды на одну часть крупы.",
      explanation: "",
      procedure: [],
      ingredients: [],
      temperatures: [],
      timings: [],
      commonMistakes: [],
      safetySensitive: false,
      safetyNotes: null,
    },
  ],
  market: {
    code: "es-ES",
    displayName: "Spain",
    language: "es",
    country: "ES",
    measurementSystem: "METRIC",
    toneNotes: "Cercano, tuteo, sin tecnicismos.",
    foodCultureNotes: "El arroz es un básico: paella, arroz caldoso, risotto como plato de moda.",
    preferredVocabulary: [{ concept: "shrimp", preferred: "gamba", avoid: ["camarón"] }],
    forbiddenPatterns: [
      { pattern: "\\bcamar[oó]n\\b", kind: "REGEX", reason: "Latin American term" },
    ],
  },
  offer: { name: "Guía de cereales", type: "LEAD_MAGNET", defaultKeyword: "ARROZ" },
  conversions: [
    {
      cardId: "card-rice-1",
      kind: "TEMPERATURE",
      label: "духовка",
      source: "180 °C",
      display: "180 °C",
    },
    {
      cardId: "card-rice-1",
      kind: "TIMING",
      label: "варка",
      source: "18–20 min",
      display: "18–20 min",
    },
  ],
  siblingPlans: [
    {
      marketCode: "en",
      hookType: "MYTH_BUST",
      audienceFraming: "Home cooks who rinse every grain they cook.",
      culturalHooks: ["Rinsing rice is standard advice in US kitchens."],
      slidePlan: [
        { role: "HOOK", templateId: "A", purpose: "Myth: rinse the rice." },
        { role: "FACT", templateId: "B", purpose: "Surface starch makes it creamy." },
        { role: "STEP", templateId: "B", purpose: "Toast dry rice." },
        { role: "SUMMARY", templateId: "B", purpose: "Do not rinse." },
        { role: "CTA", templateId: "F", purpose: "Save the post." },
      ],
    },
  ],
  templateCatalog:
    'A "Hook cover" v1.0.0; roles: HOOK\nB "Headline and body" v1.0.0; roles: FACT, EXPLANATION, STEP, SUMMARY, PROBLEM\nE "Mistake and fix" v1.0.0; roles: MISTAKE, CORRECT\nF "Call to action" v1.0.0; roles: CTA',
  templates: [
    { id: "A", roles: ["HOOK"] },
    { id: "B", roles: ["FACT", "EXPLANATION", "STEP", "SUMMARY", "PROBLEM"] },
    { id: "E", roles: ["MISTAKE", "CORRECT"] },
    { id: "F", roles: ["CTA"] },
  ],
  taxonomy: {
    hookTypes: [
      { code: "MYTH_BUST", label: "Myth bust" },
      { code: "MISTAKE_CALLOUT", label: "Mistake callout" },
      { code: "CURIOSITY_GAP", label: "Curiosity gap" },
    ],
    ctaTypes: [
      { code: "SAVE", label: "Save" },
      { code: "COMMENT_KEYWORD", label: "Comment keyword" },
      { code: "NONE", label: "None" },
    ],
  },
};

/** A plan that passes the validators for FIXTURE_INPUT. */
export const FIXTURE_OUTPUT: MarketAdapterOutput = {
  audienceFraming:
    "Spanish home cooks who love rice but treat risotto as a restaurant dish. The idea shows them a technique they can use tonight.",
  terminology: [{ concept: "creamy", localTerm: "meloso", avoid: ["cremoso"] }],
  substitutions: [
    {
      original: "arborio rice",
      local: "arroz de grano redondo (bomba o arborio)",
      note: "Bomba absorbs more liquid than arborio.",
      factualImpact: "NEEDS_CHECK",
    },
  ],
  unitsPolicy: { system: "METRIC", conversions: [{ from: "180 °C", to: "180 °C" }] },
  culturalHooks: ["Sunday rice at home", "Risotto versus arroz meloso"],
  examples: ["arroz caldoso"],
  tone: "Warm and direct, tú form, no jargon.",
  hookType: "MISTAKE_CALLOUT",
  slidePlan: [
    {
      role: "HOOK",
      templateId: "A",
      purpose: "You rinse your rice, and that is the mistake.",
      knowledgeIds: [],
    },
    {
      role: "MISTAKE",
      templateId: "E",
      purpose: "Rinsing removes surface starch.",
      knowledgeIds: ["card-rice-1"],
    },
    {
      role: "EXPLANATION",
      templateId: "B",
      purpose: "Starch thickens the broth.",
      knowledgeIds: ["card-rice-1"],
    },
    {
      role: "FACT",
      templateId: "B",
      purpose: "Water ratio for long-grain rice.",
      knowledgeIds: ["card-rice-2"],
    },
    { role: "CTA", templateId: "F", purpose: "Ask for the grain guide.", knowledgeIds: [] },
  ],
  ctaApproach: { ctaType: "COMMENT_KEYWORD", keywordSuggestion: "ARROZ" },
  risks: [],
  differentiationNotes:
    "Starts from the mistake, not the myth, and puts the fix before the science, unlike the English plan.",
};
