import { defineTemplate } from "../define-template";

/** Before vs after (plan 08 §8.2.1, P1). */
export const templateC = defineTemplate({
  id: "C",
  version: "1.0.0",
  name: "Before vs after",
  priority: "P1",
  roles: ["COMPARISON"],
  textSlots: {
    beforeLabel: {
      maxChars: 20,
      maxLines: 1,
      required: true,
      font: "display",
      minPx: 32,
      maxPx: 44,
    },
    afterLabel: {
      maxChars: 20,
      maxLines: 1,
      required: true,
      font: "display",
      minPx: 32,
      maxPx: 44,
    },
    caption: { maxChars: 140, maxLines: 3, required: true, font: "body", minPx: 32, maxPx: 40 },
  },
  imageSlots: {
    before: { aspect: "8:5", required: true },
    after: { aspect: "8:5", required: true },
  },
  logo: { anchor: "bottom-left", heightPx: 48 },
});
