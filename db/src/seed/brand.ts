import type { brands } from "../schema";

export const BRAND_SLUG = "regchef";

export const brand: typeof brands.$inferInsert = {
  slug: BRAND_SLUG,
  name: "Reg.Chef",
  description: "Culinary school and publisher; source IP is in Russian.",
  // Placeholder until the voice guide is written in /settings/brand (M0-18).
  brandVoice: "# Reg.Chef voice\n\nTo be written: tone, point of view, vocabulary, do and don't.",
};
