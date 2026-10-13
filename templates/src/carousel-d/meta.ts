import { defineTemplate } from "../define-template";

/** Diagram / mechanism (plan 08 §8.2.1, P1): a title and 3–5 points drawn as a thin-line tree. */
export const templateD = defineTemplate({
  id: "D",
  version: "2.0.1",
  name: "Diagram / mechanism",
  priority: "P1",
  roles: ["EXPLANATION", "STEP"],
  textSlots: {
    title: { maxChars: 60, maxLines: 3, required: true, font: "display", minPx: 52, maxPx: 84 },
    step1: { maxChars: 60, maxLines: 3, required: true, font: "body", minPx: 32, maxPx: 34 },
    step2: { maxChars: 60, maxLines: 3, required: true, font: "body", minPx: 32, maxPx: 34 },
    step3: { maxChars: 60, maxLines: 3, required: true, font: "body", minPx: 32, maxPx: 34 },
    step4: { maxChars: 60, maxLines: 3, required: false, font: "body", minPx: 32, maxPx: 34 },
    step5: { maxChars: 60, maxLines: 3, required: false, font: "body", minPx: 32, maxPx: 34 },
  },
  imageSlots: { image: { aspect: "4:5", required: false } },
  logo: { anchor: "bottom-left", heightPx: 48 },
});
