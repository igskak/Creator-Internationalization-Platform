import { readFileSync } from "node:fs";
import { assetPath } from "./assets-path";

// The icon set of template D (plan 08 §8.2.1): five original line icons in `assets/icons`, drawn
// with `currentColor`, one per step in order.

export const STEP_ICONS = ["water", "heat", "time", "stir", "rest"] as const;
export type StepIcon = (typeof STEP_ICONS)[number];

const cache = new Map<string, string>();

/** The SVG markup of an icon (cached). */
export function readIcon(name: StepIcon): string {
  let svg = cache.get(name);
  if (!svg) {
    svg = readFileSync(assetPath(`icons/${name}.svg`), "utf8").trim();
    cache.set(name, svg);
  }
  return svg;
}
