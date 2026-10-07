import type { IdeaGeneratorInput, IdeaGeneratorOutput } from "./schema";

// Synthetic input and output for the tests and the fake LLM provider.

export const FIXTURE_INPUT: IdeaGeneratorInput = {
  count: 2,
  focus: "grains and rice",
  cards: [
    {
      id: "card-rice-1",
      category: "GRAINS_RICE_PASTA",
      title: "Промывка риса",
      claim: "Рис для ризотто не промывают: крахмал на поверхности зерна делает блюдо кремовым.",
      language: "ru",
      version: 2,
    },
    {
      id: "card-rice-2",
      category: "GRAINS_RICE_PASTA",
      title: "Соотношение воды и риса",
      claim: "Для рассыпчатого длиннозёрного риса берут две части воды на одну часть крупы.",
      language: "ru",
      version: 1,
    },
    {
      id: "card-egg-1",
      category: "EGGS",
      title: "Температура яиц",
      claim: "Яйца комнатной температуры реже трескаются при варке.",
      language: "ru",
      version: 1,
    },
  ],
  recentIdeas: [
    {
      topic: "Why scrambled eggs turn rubbery",
      category: "EGGS",
      angle: "SCIENCE_EXPLAINER",
      coreMessage: "High heat squeezes water out of egg proteins, so scrambled eggs go dry.",
      status: "ACCEPTED",
    },
  ],
  offers: [
    {
      productCode: "RICE-GUIDE",
      productName: "Guide to grains",
      productType: "GUIDE",
      offerName: "Grain basics, free chapter",
      offerType: "LEAD_MAGNET",
      marketCode: "en",
      priority: 10,
    },
  ],
  markets: [
    {
      code: "es-ES",
      displayName: "Spain",
      language: "es",
      foodCultureNotes: "Rice is central: paella, arroz caldoso.",
      toneNotes: "Warm, direct, tú form.",
    },
    {
      code: "en",
      displayName: "English",
      language: "en",
      foodCultureNotes: "Home cooks, US-friendly units.",
      toneNotes: "Friendly and concise.",
    },
  ],
  taxonomy: {
    categories: [
      { code: "GRAINS_RICE_PASTA", label: "Grains, rice, pasta" },
      { code: "EGGS", label: "Eggs" },
    ],
    angles: [
      { code: "COMMON_MISTAKE", label: "Common mistake" },
      { code: "TECHNIQUE_HOW_TO", label: "Technique how-to", description: "A step-by-step method" },
    ],
  },
};

export const FIXTURE_OUTPUT: IdeaGeneratorOutput = {
  ideas: [
    {
      topic: "Do not rinse risotto rice",
      category: "GRAINS_RICE_PASTA",
      angle: "COMMON_MISTAKE",
      coreMessage: "Rinsing risotto rice washes away the surface starch that makes it creamy.",
      primaryKnowledgeIds: ["card-rice-1"],
      supportingKnowledgeIds: [],
      recommendedFormat: "CAROUSEL",
      commercialIntent: "LEAD_MAGNET",
      productCode: "RICE-GUIDE",
      rationale: "Card card-rice-1 states that surface starch makes risotto creamy.",
      whyNow:
        "Grains are uncovered by recent ideas and the grain guide has the top offer priority.",
      differsFromRecent: "Rice, not eggs; a mistake angle instead of a science explainer.",
    },
    {
      topic: "The water ratio for fluffy rice",
      category: "GRAINS_RICE_PASTA",
      angle: "TECHNIQUE_HOW_TO",
      coreMessage: "Long-grain rice stays fluffy at two parts water to one part rice.",
      primaryKnowledgeIds: ["card-rice-2"],
      supportingKnowledgeIds: ["card-egg-1"],
      recommendedFormat: "CAROUSEL",
      commercialIntent: "NONE",
      productCode: null,
      rationale: "Card card-rice-2 gives the two-to-one ratio.",
      whyNow: "A how-to complements the mistake idea in this batch.",
      differsFromRecent: "A method, and a different primary card from the first idea.",
    },
  ],
};
