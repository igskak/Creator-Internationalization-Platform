import { defineTemplate } from "../define-template";

/**
 * CTA / lead magnet / offer (plan 08 §8.2.1). From 3.0.0 (carousel v3) the body is a ladder of
 * short lines (the recap, the offer, the steps of the ask) and the keyword can be large.
 */
export const templateF = defineTemplate({
  id: "F",
  version: "3.0.0",
  name: "CTA / lead magnet / offer",
  priority: "P0",
  roles: ["CTA"],
  textSlots: {
    headline: { maxChars: 60, maxLines: 3, required: true, font: "display", minPx: 48, maxPx: 80 },
    body: { maxChars: 300, maxLines: 11, required: true, font: "body", minPx: 26, maxPx: 30 },
    keyword: { maxChars: 16, maxLines: 1, required: false, font: "display", minPx: 44, maxPx: 96 },
    offerName: {
      maxChars: 40,
      maxLines: 2,
      required: false,
      font: "display",
      minPx: 20,
      maxPx: 24,
    },
  },
  imageSlots: { product: { aspect: "4:5", required: false } },
  logo: { anchor: "bottom-left", heightPx: 48 },
});
