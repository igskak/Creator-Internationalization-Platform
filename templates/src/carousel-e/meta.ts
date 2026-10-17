import { defineTemplate } from "../define-template";

/**
 * Mistake vs correct technique (plan 08 §8.2.1). From 3.0.0 (carousel v3) the two texts are
 * ladders of short lines in a narrow column, with an optional bold closing line.
 */
export const templateE = defineTemplate({
  id: "E",
  version: "3.0.0",
  name: "Mistake vs correct technique",
  priority: "P0",
  roles: ["MISTAKE", "CORRECT"],
  textSlots: {
    mistakeTitle: {
      maxChars: 40,
      maxLines: 2,
      required: true,
      font: "display",
      minPx: 32,
      maxPx: 44,
    },
    mistakeText: { maxChars: 200, maxLines: 7, required: true, font: "body", minPx: 26, maxPx: 28 },
    correctTitle: {
      maxChars: 40,
      maxLines: 3,
      required: true,
      font: "display",
      minPx: 46,
      maxPx: 68,
    },
    correctText: {
      maxChars: 300,
      maxLines: 10,
      required: true,
      font: "body",
      minPx: 26,
      maxPx: 30,
    },
    closer: { maxChars: 60, maxLines: 2, required: false, font: "display", minPx: 26, maxPx: 30 },
  },
  imageSlots: { image: { aspect: "4:5", required: false } },
  logo: { anchor: "bottom-left", heightPx: 48 },
});
