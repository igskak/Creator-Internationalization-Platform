import { defineTemplate } from "../define-template";

/**
 * Large number / fact + explanation (plan 08 §8.2.1). Without `number` it is a headline + body
 * slide. PROBLEM is added to the roles of the plan table, which left it without a P0 template.
 */
export const templateB = defineTemplate({
  id: "B",
  version: "1.0.0",
  name: "Large number / fact + explanation",
  priority: "P0",
  roles: ["FACT", "EXPLANATION", "STEP", "SUMMARY", "PROBLEM"],
  textSlots: {
    number: { maxChars: 8, maxLines: 1, required: false, font: "display", minPx: 120, maxPx: 240 },
    label: { maxChars: 40, maxLines: 1, required: false, font: "body", minPx: 32, maxPx: 40 },
    headline: { maxChars: 60, maxLines: 2, required: false, font: "display", minPx: 56, maxPx: 80 },
    body: { maxChars: 220, maxLines: 6, required: true, font: "body", minPx: 32, maxPx: 44 },
  },
  imageSlots: { side: { aspect: "1:1", required: false } },
  logo: { anchor: "bottom-left", heightPx: 48 },
});
