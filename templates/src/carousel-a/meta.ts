import { defineTemplate } from "../define-template";

/** Hero ingredient + strong hook (plan 08 §8.2.1; look: docs/design/carousel-style.md). */
export const templateA = defineTemplate({
  id: "A",
  version: "3.0.0",
  name: "Hero ingredient + strong hook",
  priority: "P0",
  roles: ["HOOK"],
  textSlots: {
    kicker: { maxChars: 24, maxLines: 1, required: false, font: "display", minPx: 24, maxPx: 28 },
    headline: { maxChars: 70, maxLines: 4, required: true, font: "display", minPx: 64, maxPx: 100 },
    subline: { maxChars: 140, maxLines: 4, required: false, font: "body", minPx: 28, maxPx: 32 },
  },
  imageSlots: { hero: { aspect: "4:5", required: true, fullBleed: true } },
  logo: { anchor: "bottom-left", heightPx: 48 },
});
