import { defineTemplate } from "../define-template";

/** Hero ingredient + strong hook (plan 08 §8.2.1). */
export const templateA = defineTemplate({
  id: "A",
  version: "1.0.0",
  name: "Hero ingredient + strong hook",
  priority: "P0",
  roles: ["HOOK"],
  textSlots: {
    kicker: { maxChars: 24, maxLines: 1, required: false, font: "display", minPx: 28, maxPx: 34 },
    headline: { maxChars: 70, maxLines: 3, required: true, font: "display", minPx: 64, maxPx: 96 },
    subline: { maxChars: 90, maxLines: 2, required: false, font: "body", minPx: 32, maxPx: 38 },
  },
  imageSlots: { hero: { aspect: "4:5", required: true, fullBleed: true } },
  logo: { anchor: "bottom-left", heightPx: 48 },
});
