import { defineTemplate } from "../define-template";

/** Mistake vs correct technique (plan 08 §8.2.1). */
export const templateE = defineTemplate({
  id: "E",
  version: "1.0.0",
  name: "Mistake vs correct technique",
  priority: "P0",
  roles: ["MISTAKE", "CORRECT"],
  textSlots: {
    mistakeTitle: {
      maxChars: 40,
      maxLines: 1,
      required: true,
      font: "display",
      minPx: 40,
      maxPx: 56,
    },
    mistakeText: { maxChars: 140, maxLines: 4, required: true, font: "body", minPx: 32, maxPx: 40 },
    correctTitle: {
      maxChars: 40,
      maxLines: 1,
      required: true,
      font: "display",
      minPx: 40,
      maxPx: 56,
    },
    correctText: { maxChars: 140, maxLines: 4, required: true, font: "body", minPx: 32, maxPx: 40 },
  },
  imageSlots: { image: { aspect: "1:1", required: false } },
  logo: { anchor: "bottom-left", heightPx: 48 },
});
