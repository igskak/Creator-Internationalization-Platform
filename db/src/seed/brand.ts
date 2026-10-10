import type { brands } from "../schema";

export const BRAND_SLUG = "main";

export const brand: typeof brands.$inferInsert = {
  slug: BRAND_SLUG,
  name: "Main brand",
  description: "Culinary knowledge in Russian, published as independent market accounts.",
  // Placeholder until the voice guide is written in /settings/brand (M0-18).
  brandVoice: "# Brand voice\n\nTo be written: tone, point of view, vocabulary, do and don't.",
};
