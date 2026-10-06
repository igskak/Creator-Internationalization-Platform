import type { AnnotatorInput, AnnotatorOutput } from "./schema";

// Synthetic input and output for the tests and the fake LLM provider.

export const FIXTURE_INPUT: AnnotatorInput = {
  language: "ru",
  posts: [
    {
      id: "post-1",
      format: "CAROUSEL",
      caption:
        "Почему ваш омлет похож на сухую губку? Яйца нужно не взбивать, а процеживать.\n\nСохрани, чтобы не потерять.",
    },
    { id: "post-2", format: null, caption: "Доброе утро! ☕" },
  ],
  taxonomy: {
    categories: [
      { code: "EGGS", label: "Eggs" },
      { code: "GRAINS_RICE_PASTA", label: "Grains rice pasta" },
    ],
    angles: [
      { code: "COMMON_MISTAKE", label: "Common mistake" },
      { code: "MYTH_VS_FACT", label: "Myth vs fact" },
    ],
    hookTypes: [
      { code: "QUESTION", label: "Question" },
      { code: "CURIOSITY_GAP", label: "Curiosity gap" },
    ],
    ctaTypes: [
      { code: "SAVE", label: "Save" },
      { code: "NONE", label: "No call to action" },
    ],
  },
};

export const FIXTURE_OUTPUT: AnnotatorOutput = {
  annotations: [
    {
      postId: "post-1",
      category: "EGGS",
      angle: "COMMON_MISTAKE",
      hookType: "QUESTION",
      ctaType: "SAVE",
    },
    { postId: "post-2", category: null, angle: null, hookType: null, ctaType: "NONE" },
  ],
};
