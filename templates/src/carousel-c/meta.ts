import { defineTemplate } from "../define-template";

/**
 * Before vs after (plan 08 §8.2.1, P1). The two pictures flank the slide: each is a cut-out with
 * one centred subject, cut by the left and the right edge.
 */
export const templateC = defineTemplate({
  id: "C",
  version: "3.0.0",
  name: "Before vs after",
  priority: "P1",
  roles: ["COMPARISON"],
  textSlots: {
    beforeLabel: {
      maxChars: 20,
      maxLines: 2,
      required: true,
      font: "display",
      minPx: 40,
      maxPx: 56,
    },
    afterLabel: {
      maxChars: 20,
      maxLines: 2,
      required: true,
      font: "display",
      minPx: 40,
      maxPx: 56,
    },
    caption: { maxChars: 140, maxLines: 4, required: true, font: "body", minPx: 32, maxPx: 36 },
  },
  imageSlots: {
    before: { aspect: "4:5", required: true },
    after: { aspect: "4:5", required: true },
  },
  logo: { anchor: "bottom-left", heightPx: 48 },
});
