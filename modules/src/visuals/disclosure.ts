import { schema } from "@rc/db";
import type { Slide, SnapshotDisclosure } from "@rc/db/json";
import { and, eq, inArray } from "@rc/db/orm";
import type { ServiceContext } from "../core";

// AI imagery disclosure (plan 08 §8.4, 09 §9.3, M5-12, V-16). Per market: nothing, a note in the
// caption, a badge on the slides that carry a generated image, or Instagram's own "AI info" label
// (`is_ai_generated` at publishing, available since 2026-06-22). The decision is made when a draft
// is approved and stored in the approved snapshot, so what is published is exactly what the
// reviewer saw. Whether a picture counts as "photo-realistic" is not recorded anywhere, so every
// generated image that appears on a slide counts (the conservative reading; the legal review in
// B-13 may narrow it).

export const DISCLOSURE_NOTES: Record<string, string> = {
  es: "Imágenes generadas con IA.",
  en: "Images created with AI.",
  ru: "Изображения созданы с помощью ИИ.",
};

/** The note in the language of a market (English where the language has no text yet). */
export const disclosureNote = (language: string): string =>
  DISCLOSURE_NOTES[language] ?? (DISCLOSURE_NOTES.en as string);

/** Ids of the slides whose images include a generated one that is ready. */
export async function slidesWithGeneratedImages(
  ctx: ServiceContext,
  slides: readonly Slide[],
): Promise<Set<string>> {
  const ids = [
    ...new Set(
      slides.flatMap((s) => Object.values(s.images).flatMap((i) => (i.assetId ? [i.assetId] : []))),
    ),
  ];
  if (ids.length === 0) return new Set();
  const rows = await ctx.db
    .select({ id: schema.visualAssets.id })
    .from(schema.visualAssets)
    .where(and(inArray(schema.visualAssets.id, ids), eq(schema.visualAssets.isAiGenerated, true)));
  const ai = new Set(rows.map((r) => r.id));
  return new Set(
    slides
      .filter((s) => Object.values(s.images).some((i) => i.assetId && ai.has(i.assetId)))
      .map((s) => s.id),
  );
}

/**
 * What the market's setting adds to this draft, or undefined when nothing is added (setting NONE,
 * or no generated image on any slide). `mode` is the market's setting; the booleans are the
 * effects.
 */
export async function planDisclosure(
  ctx: ServiceContext,
  input: { marketId: string; slides: readonly Slide[] },
): Promise<SnapshotDisclosure | undefined> {
  const [market] = await ctx.db
    .select({
      mode: schema.markets.aiImageryDisclosure,
      language: schema.markets.language,
    })
    .from(schema.markets)
    .where(eq(schema.markets.id, input.marketId));
  if (!market || market.mode === "NONE") return undefined;
  if ((await slidesWithGeneratedImages(ctx, input.slides)).size === 0) return undefined;
  switch (market.mode) {
    case "CAPTION_NOTE":
      return { mode: "CAPTION_NOTE", captionNote: disclosureNote(market.language) };
    case "SLIDE_BADGE":
      return { mode: "SLIDE_BADGE", badge: true };
    case "PLATFORM_LABEL":
      return { mode: "PLATFORM_LABEL", platformLabel: true };
  }
}
