import type { VisualDirectorInput, VisualDirectorOutput } from "./schema";

// Synthetic input and output for the tests and the fake LLM provider. Not Reg.Chef content.

export const FIXTURE_INPUT: VisualDirectorInput = {
  idea: {
    topic: "Rinsing rice",
    coreMessage: "Rinse rice until the water runs clear for separate, fluffy grains.",
  },
  market: {
    code: "es-ES",
    displayName: "Spain",
    hypotheses: [
      {
        id: "h-mediterranean",
        description: "Warm Mediterranean light, terracotta and olive tones.",
        visualStyle: "WARM_RUSTIC",
        status: "UNTESTED",
      },
    ],
  },
  slides: [
    {
      slideId: "s1",
      index: 0,
      role: "HOOK",
      templateId: "A",
      slots: [{ name: "headline", text: "Stop skipping this step" }],
      imageSlots: [{ name: "hero", aspect: "4:5", required: true }],
    },
    {
      slideId: "s2",
      index: 1,
      role: "EXPLANATION",
      templateId: "B",
      slots: [{ name: "body", text: "The water turns cloudy because of loose starch." }],
      imageSlots: [{ name: "side", aspect: "1:1", required: false }],
    },
    {
      slideId: "s3",
      index: 2,
      role: "CTA",
      templateId: "F",
      slots: [{ name: "headline", text: "Get the full guide" }],
      imageSlots: [{ name: "product", aspect: "1:1", required: false }],
    },
  ],
  libraryCandidates: [
    { id: "lib-1", description: "A bowl of rinsed rice on a dark slate.", tags: ["rice"] },
  ],
  siblingBriefs: [
    {
      marketCode: "en",
      concept: "Cool, clean kitchen light.",
      visualStyle: "CLEAN_MINIMAL",
      compositions: ["Rice in a steel colander, top view"],
    },
  ],
  visualStyles: [
    { code: "WARM_RUSTIC", label: "Warm rustic" },
    { code: "CLEAN_MINIMAL", label: "Clean minimal" },
  ],
};

export const FIXTURE_OUTPUT: VisualDirectorOutput = {
  concept:
    "Warm terracotta light over one bowl of rice; every slide shares the same soft side light.",
  visualStyle: "WARM_RUSTIC",
  hypothesisId: "h-mediterranean",
  slides: [
    {
      slideId: "s1",
      slot: "hero",
      source: "GENERATE",
      prompt:
        "Macro photo of cloudy rinse water swirling around white rice grains in a terracotta bowl, soft side light, shallow depth of field, calm empty area at the top",
      negativePrompt: "text, letters, logos, packaging, hands, clutter, harsh flash",
      composition: "Bowl low in the frame, the upper third left empty for the headline.",
      aspect: "4:5",
    },
    {
      slideId: "s2",
      slot: "side",
      source: "LIBRARY",
      libraryAssetId: "lib-1",
      composition: "Square crop of the rice bowl.",
      aspect: "1:1",
    },
    {
      slideId: "s3",
      slot: "product",
      source: "NONE",
      composition: "No picture; the slide is text only.",
      aspect: "1:1",
    },
  ],
  differentiationFromSibling:
    "Low three-quarter angle in a terracotta bowl instead of a top view of a steel colander.",
};
