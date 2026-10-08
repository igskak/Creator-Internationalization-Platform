import type { EvalJudgeInput, EvalJudgeOutput } from "./schema";

// Synthetic input and output for the tests and the fake model. Not Reg.Chef content.

export const FIXTURE_INPUT: EvalJudgeInput = {
  brandVoice: "Warm and precise. No hype.",
  idea: { topic: "Rice", coreMessage: "Do not rinse risotto rice." },
  cards: [
    {
      id: "card-1",
      title: "Rinsing rice",
      claim: "Risotto rice is not rinsed: the surface starch makes it creamy.",
      explanation: "",
      language: "en",
    },
  ],
  market: { code: "es-ES", displayName: "Spain", language: "es", toneNotes: "Cercano, tuteo." },
  draft: {
    hook: "Lavas el arroz del risotto. Ese es el error.",
    slides: [
      { role: "HOOK", text: "Lavas el arroz del risotto.", cites: [] },
      { role: "FACT", text: "El almidón de la superficie lo hace meloso.", cites: ["card-1"] },
    ],
    caption: "No laves el arroz. El almidón hace el plato meloso.",
    cta: "Guárdalo.",
    hashtags: ["#risotto", "#arroz", "#cocina"],
  },
};

export const FIXTURE_OUTPUT: EvalJudgeOutput = {
  scores: { factualFidelity: 5, localization: 4, voice: 4 },
  unsupportedClaims: [],
  note: "Natural Spanish; the hook could be a little less blunt.",
};
