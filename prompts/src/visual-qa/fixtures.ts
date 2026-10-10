import type { VisualQaInput, VisualQaOutput } from "./schema";

// Synthetic input and output for the tests and the fake LLM provider. Not Reg.Chef content.

export const FIXTURE_INPUT: VisualQaInput = {
  market: { code: "es-ES", displayName: "Spain" },
  brandVoice: "Warm and precise.",
  slides: [
    {
      slideId: "s1",
      index: 0,
      role: "HOOK",
      templateId: "A",
      texts: [{ slot: "headline", text: "¿Por qué no lavar el arroz?" }],
    },
    {
      slideId: "s2",
      index: 1,
      role: "FACT",
      templateId: "B",
      texts: [
        { slot: "number", text: "2:1" },
        { slot: "body", text: "Dos partes de agua por una de arroz." },
      ],
    },
  ],
};

export const FIXTURE_OUTPUT: VisualQaOutput = {
  issues: [
    {
      slideId: "s1",
      severity: "MAJOR",
      category: "LEGIBILITY",
      explanation: "The headline sits over the bright rim of the bowl and is hard to read.",
      suggestedFix: "Regenerate the picture with a calmer, darker lower half.",
    },
  ],
};
