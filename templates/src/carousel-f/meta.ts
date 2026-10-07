import { defineTemplate } from "../define-template";

/** CTA / lead magnet / offer (plan 08 §8.2.1). */
export const templateF = defineTemplate({
  id: "F",
  version: "1.0.0",
  name: "CTA / lead magnet / offer",
  priority: "P0",
  roles: ["CTA"],
  textSlots: {
    headline: { maxChars: 60, maxLines: 2, required: true, font: "display", minPx: 56, maxPx: 80 },
    body: { maxChars: 160, maxLines: 4, required: true, font: "body", minPx: 32, maxPx: 40 },
    keyword: { maxChars: 16, maxLines: 1, required: false, font: "display", minPx: 48, maxPx: 72 },
    offerName: { maxChars: 40, maxLines: 1, required: false, font: "body", minPx: 32, maxPx: 40 },
  },
  imageSlots: { product: { aspect: "1:1", required: false } },
  logo: { anchor: "bottom-left", heightPx: 48 },
});
