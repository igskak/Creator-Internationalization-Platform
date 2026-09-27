import type { TaxonomyKind, taxonomyTerms } from "../schema";

// Initial taxonomy from plan 04 §4.7; to be refined with Sergey (Track B B-08). Labels are
// derived from codes and can be edited in /settings/brand.
const CODES: Partial<Record<TaxonomyKind, string[]>> = {
  category: [
    "FISH_SEAFOOD",
    "MEAT",
    "POULTRY",
    "EGGS",
    "DAIRY",
    "VEGETABLES",
    "GRAINS_RICE_PASTA",
    "BAKING_DOUGH",
    "SAUCES_STOCKS",
    "TECHNIQUES",
    "FOOD_SCIENCE",
    "EQUIPMENT",
    "STORAGE_SAFETY",
    "SPICES_SEASONING",
  ],
  angle: [
    "COMMON_MISTAKE",
    "MYTH_VS_FACT",
    "SCIENCE_EXPLAINER",
    "TECHNIQUE_HOW_TO",
    "COMPARISON",
    "INGREDIENT_SPOTLIGHT",
    "QUICK_TIP",
    "CHECKLIST",
    "RECIPE_WALKTHROUGH",
    "TROUBLESHOOTING",
  ],
  hook_type: [
    "MISTAKE_CALLOUT",
    "CURIOSITY_GAP",
    "NUMBER_OR_STAT",
    "MYTH_BUST",
    "BOLD_CLAIM",
    "DIRECT_QUESTION",
    "BEFORE_AFTER",
    "HOW_TO_PROMISE",
    "CONTRARIAN",
    "RELATABLE_PROBLEM",
  ],
  cta_type: ["SAVE", "SHARE", "FOLLOW", "COMMENT_KEYWORD", "DM_KEYWORD", "LINK_IN_BIO", "NONE"],
  visual_style: [
    "EDITORIAL_MACRO",
    "FOOD_SCIENCE_DIAGRAM",
    "WARM_MEDITERRANEAN",
    "CLEAN_STUDIO",
    "DARK_MOODY",
    "TEXT_FORWARD",
  ],
  reason_code: [
    "WEAK_HOOK",
    "FACTUAL_ERROR",
    "UNSUPPORTED_CLAIM",
    "UNNATURAL_LANGUAGE",
    "TRANSLATIONESE",
    "WRONG_TERMINOLOGY",
    "OFF_BRAND_VOICE",
    "TOO_LONG",
    "VISUAL_ISSUE",
    "TOO_SIMILAR_TO_OTHER_MARKET",
    "CTA_ISSUE",
    "SAFETY",
    "OTHER",
  ],
};

/** FISH_SEAFOOD → "Fish seafood"; MYTH_VS_FACT → "Myth vs fact"; DM_KEYWORD → "DM keyword". */
export function labelFromCode(code: string): string {
  const words = code.split("_").map((w) => (w === "DM" ? w : w.toLowerCase()));
  const [first = "", ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}

export const taxonomySeeds: (typeof taxonomyTerms.$inferInsert)[] = Object.entries(CODES).flatMap(
  ([kind, codes]) =>
    (codes ?? []).map((code, index) => ({
      kind: kind as TaxonomyKind,
      code,
      label: labelFromCode(code),
      sortOrder: index + 1,
    })),
);
