import { defineTemplate } from "../define-template";

/**
 * Large number / fact + explanation (plan 08 §8.2.1). Without `number` it is a headline + body
 * slide. PROBLEM is added to the roles of the plan table, which left it without a P0 template.
 * The picture is a cut-out on white bleeding off the right and bottom edges.
 */
export const templateB = defineTemplate({
  id: "B",
  version: "2.0.1",
  name: "Large number / fact + explanation",
  priority: "P0",
  roles: ["FACT", "EXPLANATION", "STEP", "SUMMARY", "PROBLEM"],
  textSlots: {
    number: { maxChars: 8, maxLines: 1, required: false, font: "display", minPx: 96, maxPx: 150 },
    label: { maxChars: 40, maxLines: 1, required: false, font: "display", minPx: 20, maxPx: 24 },
    headline: { maxChars: 60, maxLines: 4, required: false, font: "display", minPx: 52, maxPx: 84 },
    body: { maxChars: 220, maxLines: 9, required: true, font: "body", minPx: 32, maxPx: 34 },
  },
  imageSlots: { side: { aspect: "4:5", required: false } },
  logo: { anchor: "bottom-left", heightPx: 48 },
});
