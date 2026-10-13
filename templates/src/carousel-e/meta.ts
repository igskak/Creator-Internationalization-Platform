import { defineTemplate } from "../define-template";

/** Mistake vs correct technique (plan 08 §8.2.1). */
export const templateE = defineTemplate({
  id: "E",
  version: "2.0.1",
  name: "Mistake vs correct technique",
  priority: "P0",
  roles: ["MISTAKE", "CORRECT"],
  textSlots: {
    mistakeTitle: {
      maxChars: 40,
      maxLines: 2,
      required: true,
      font: "display",
      minPx: 36,
      maxPx: 52,
    },
    mistakeText: { maxChars: 140, maxLines: 5, required: true, font: "body", minPx: 32, maxPx: 32 },
    correctTitle: {
      maxChars: 40,
      maxLines: 3,
      required: true,
      font: "display",
      minPx: 52,
      maxPx: 84,
    },
    correctText: { maxChars: 140, maxLines: 6, required: true, font: "body", minPx: 32, maxPx: 34 },
  },
  imageSlots: { image: { aspect: "4:5", required: false } },
  logo: { anchor: "bottom-left", heightPx: 48 },
});
