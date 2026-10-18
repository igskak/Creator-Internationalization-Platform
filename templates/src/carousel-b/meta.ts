import { defineTemplate } from "../define-template";

/**
 * Large number / fact + explanation (plan 08 §8.2.1). Without `number` it is a headline + body
 * slide. PROBLEM is added to the roles of the plan table, which left it without a P0 template.
 * The picture is a cut-out on white, placed beside the text by its measured subject. From 3.0.0
 * (carousel v3) the body is a "ladder" of short lines in a narrow column, with an optional
 * regular-weight lead above the headline and a bold closing line under the body.
 */
export const templateB = defineTemplate({
  id: "B",
  version: "3.0.0",
  name: "Large number / fact + explanation",
  priority: "P0",
  roles: ["FACT", "EXPLANATION", "STEP", "SUMMARY", "PROBLEM"],
  textSlots: {
    number: { maxChars: 8, maxLines: 1, required: false, font: "display", minPx: 80, maxPx: 110 },
    label: { maxChars: 40, maxLines: 1, required: false, font: "display", minPx: 20, maxPx: 22 },
    lead: { maxChars: 50, maxLines: 2, required: false, font: "display", minPx: 34, maxPx: 44 },
    headline: { maxChars: 60, maxLines: 3, required: false, font: "display", minPx: 46, maxPx: 72 },
    body: { maxChars: 380, maxLines: 13, required: true, font: "body", minPx: 26, maxPx: 30 },
    closer: { maxChars: 60, maxLines: 2, required: false, font: "display", minPx: 26, maxPx: 30 },
  },
  imageSlots: { side: { aspect: "4:5", required: false } },
  logo: { anchor: "bottom-left", heightPx: 48 },
});
