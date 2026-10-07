import { defineTemplate } from "../define-template";

/**
 * Diagram / mechanism (plan 08 §8.2.1, P1): a title and 3–5 steps. The per-step icon comes from
 * the icon set in the renderer, so it is not a slot here.
 */
export const templateD = defineTemplate({
  id: "D",
  version: "1.0.0",
  name: "Diagram / mechanism",
  priority: "P1",
  roles: ["EXPLANATION", "STEP"],
  textSlots: {
    title: { maxChars: 60, maxLines: 2, required: true, font: "display", minPx: 56, maxPx: 80 },
    step1: { maxChars: 60, maxLines: 2, required: true, font: "body", minPx: 32, maxPx: 40 },
    step2: { maxChars: 60, maxLines: 2, required: true, font: "body", minPx: 32, maxPx: 40 },
    step3: { maxChars: 60, maxLines: 2, required: true, font: "body", minPx: 32, maxPx: 40 },
    step4: { maxChars: 60, maxLines: 2, required: false, font: "body", minPx: 32, maxPx: 40 },
    step5: { maxChars: 60, maxLines: 2, required: false, font: "body", minPx: 32, maxPx: 40 },
  },
  imageSlots: { image: { aspect: "1:1", required: false } },
  logo: { anchor: "bottom-left", heightPx: 48 },
});
