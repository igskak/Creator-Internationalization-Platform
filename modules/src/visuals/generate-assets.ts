import { createHash } from "node:crypto";
import { schema } from "@rc/db";
import type { Slide, VariantFlag, VisualBrief } from "@rc/db/json";
import { and, eq, sql } from "@rc/db/orm";
import { InvalidStateError, NotFoundError, TransientError } from "@rc/lib/errors";
import type { ImageAspect } from "@rc/lib/providers/image";
import { registry } from "@rc/templates";
import { z } from "zod";
import { audit, type ServiceContext } from "../core";
import { assetKeys, normalizeImage, perceptualHash, type SlotAspect } from "./images";
import { assertLibraryPhotoUsable } from "./library";

// The `generate-visual-assets` job (plan 06 J7, M3-05): for every picture of a variant's visual
// brief a provider call, normalization, two objects in storage and a `visual_assets` row; the
// slide's image slot then points at the asset. A rerun finds what is READY and pays for nothing
// twice (the unique index on variant, slide, slot and prompt hash); a failed slot is reported, the
// others go on, and `VISUAL_MISSING` says whether a required slot is still empty.

export const GenerateVisualAssetsPayload = z.object({
  variantId: z.uuid(),
  /** Only these slots (a retry of failed ones); default: every slot of the brief. */
  slots: z.array(z.object({ slideId: z.string().min(1), slot: z.string().min(1) })).optional(),
});
export type GenerateVisualAssetsPayload = z.infer<typeof GenerateVisualAssetsPayload>;

export type SlotOutcome = {
  slideId: string;
  slot: string;
  status: "GENERATED" | "REUSED" | "LIBRARY" | "SKIPPED" | "FAILED";
  assetId?: string;
  error?: string;
};

export type GenerateVisualAssetsResult = {
  variantId: string;
  outcomes: SlotOutcome[];
  costUsd: number;
  /** A required image slot is still empty. */
  visualMissing: boolean;
};

const EDITABLE = ["READY_FOR_REVIEW", "CHANGES_REQUESTED"];
const CONCURRENCY = 3;

/** Same slot, same wording, same aspect and model → same hash → the same asset. */
export const promptHashOf = (
  entry: Pick<VisualBrief["slides"][number], "prompt" | "negativePrompt" | "aspect">,
  model: string,
): string =>
  createHash("sha256")
    .update(JSON.stringify([entry.prompt ?? "", entry.negativePrompt ?? "", entry.aspect, model]))
    .digest("hex")
    .slice(0, 16);

const slotAspect = (slide: Slide, slot: string, fallback: SlotAspect): SlotAspect =>
  (registry.get(slide.templateId)?.imageSlots[slot]?.aspect as SlotAspect | undefined) ?? fallback;

export async function generateVisualAssets(
  ctx: ServiceContext,
  raw: GenerateVisualAssetsPayload,
): Promise<GenerateVisualAssetsResult> {
  const { variantId, slots } = GenerateVisualAssetsPayload.parse(raw);
  const [variant] = await ctx.db
    .select()
    .from(schema.contentVariants)
    .where(eq(schema.contentVariants.id, variantId));
  if (!variant) throw new NotFoundError("Variant not found.", { details: { variantId } });
  if (!EDITABLE.includes(variant.status)) {
    throw new InvalidStateError(`A ${variant.status} variant gets no new pictures.`, {
      details: { variantId, status: variant.status },
    });
  }
  const [idea] = await ctx.db
    .select({ brandId: schema.masterIdeas.brandId })
    .from(schema.masterIdeas)
    .where(eq(schema.masterIdeas.id, variant.masterIdeaId));
  const brandId = idea?.brandId ?? "";

  const brief = variant.visualBriefJson;
  const slides: Slide[] = structuredClone(variant.slidesJson);
  const outcomes: SlotOutcome[] = [];
  let costUsd = 0;
  let transient: unknown;

  const wanted = (brief?.slides ?? []).filter(
    (e) => !slots || slots.some((s) => s.slideId === e.slideId && s.slot === e.slot),
  );

  const setImage = (slideId: string, slot: string, assetId: string) => {
    const slide = slides.find((s) => s.id === slideId);
    if (slide) slide.images = { ...slide.images, [slot]: { assetId } };
  };

  const one = async (entry: VisualBrief["slides"][number]): Promise<void> => {
    const { slideId, slot } = entry;
    const slide = slides.find((s) => s.id === slideId);
    if (!slide || !registry.get(slide.templateId)?.imageSlots[slot]) {
      outcomes.push({ slideId, slot, status: "SKIPPED", error: "The slot does not exist." });
      return;
    }
    if (entry.source === "NONE") {
      outcomes.push({ slideId, slot, status: "SKIPPED" });
      return;
    }
    if (entry.source === "LIBRARY") {
      if (!entry.libraryAssetId) {
        outcomes.push({ slideId, slot, status: "FAILED", error: "No library photo given." });
        return;
      }
      // The rights may have changed since the brief was made: check again before using it.
      const usable = await assertLibraryPhotoUsable(ctx, entry.libraryAssetId).then(
        () => true,
        () => false,
      );
      if (!usable) {
        outcomes.push({
          slideId,
          slot,
          status: "FAILED",
          error: "The library photo is no longer available.",
        });
        return;
      }
      setImage(slideId, slot, entry.libraryAssetId);
      outcomes.push({ slideId, slot, status: "LIBRARY", assetId: entry.libraryAssetId });
      return;
    }

    const promptHash = promptHashOf(entry, ctx.images.model);
    const [existing] = await ctx.db
      .select()
      .from(schema.visualAssets)
      .where(
        and(
          eq(schema.visualAssets.contentVariantId, variantId),
          eq(schema.visualAssets.slideId, slideId),
          eq(schema.visualAssets.slot, slot),
          eq(schema.visualAssets.promptHash, promptHash),
          eq(schema.visualAssets.kind, "GENERATED"),
          eq(schema.visualAssets.status, "READY"),
        ),
      );
    if (existing) {
      setImage(slideId, slot, existing.id);
      outcomes.push({ slideId, slot, status: "REUSED", assetId: existing.id });
      return;
    }

    // The row first: a concurrent run finds it through the unique index instead of paying twice.
    const [claimed] = await ctx.db
      .insert(schema.visualAssets)
      .values({
        brandId,
        kind: "GENERATED",
        status: "PENDING",
        contentVariantId: variantId,
        slideId,
        slot,
        provider: ctx.images.id,
        model: ctx.images.model,
        prompt: entry.prompt ?? null,
        negativePrompt: entry.negativePrompt ?? null,
        promptHash,
        isAiGenerated: true,
      })
      .onConflictDoNothing()
      .returning({ id: schema.visualAssets.id });
    if (!claimed) {
      // Another run holds the same pending asset: leave it to that run.
      outcomes.push({ slideId, slot, status: "SKIPPED", error: "Being generated by another run." });
      return;
    }

    try {
      const generated = await ctx.images.generate({
        prompt: entry.prompt ?? "",
        ...(entry.negativePrompt ? { negativePrompt: entry.negativePrompt } : {}),
        aspect: entry.aspect as ImageAspect,
        label: `${slideId}/${slot}`,
      });
      const normalized = await normalizeImage(
        generated.bytes,
        slotAspect(slide, slot, entry.aspect as SlotAspect),
      );
      const keys = assetKeys({
        variantId,
        slideId,
        slot,
        promptHash,
        originalMimeType: generated.mimeType,
      });
      await ctx.storage.put(keys.originalKey, generated.bytes, { contentType: generated.mimeType });
      await ctx.storage.put(keys.storageKey, normalized.bytes, { contentType: "image/webp" });
      await ctx.db
        .update(schema.visualAssets)
        .set({
          status: "READY",
          storageKey: keys.storageKey,
          originalKey: keys.originalKey,
          mimeType: normalized.mimeType,
          width: normalized.width,
          height: normalized.height,
          bytes: normalized.bytes.byteLength,
          phash: await perceptualHash(normalized.bytes),
          params: { ...generated.params, costUsd: generated.costUsd },
          error: null,
        })
        .where(eq(schema.visualAssets.id, claimed.id));
      costUsd += generated.costUsd ?? 0;
      setImage(slideId, slot, claimed.id);
      outcomes.push({ slideId, slot, status: "GENERATED", assetId: claimed.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.db
        .update(schema.visualAssets)
        .set({ status: "FAILED", error: { code: "GENERATION_FAILED", message } })
        .where(eq(schema.visualAssets.id, claimed.id));
      outcomes.push({ slideId, slot, status: "FAILED", assetId: claimed.id, error: message });
      // A provider that is down is worth a retry of the whole job; anything else is the slot's own.
      if (error instanceof TransientError) transient ??= error;
    }
  };

  // A few at a time: the images queue limits the jobs, this limits one job's calls.
  const queue = [...wanted];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let entry = queue.shift(); entry; entry = queue.shift()) await one(entry);
    }),
  );

  // Which required slots are still empty, over the whole variant.
  const visualMissing = slides.some((slide) =>
    Object.entries(registry.get(slide.templateId)?.imageSlots ?? {}).some(
      ([name, spec]) => spec.required && !slide.images[name]?.assetId,
    ),
  );
  const flags = new Set<VariantFlag>(variant.flags as VariantFlag[]);
  if (visualMissing) flags.add("VISUAL_MISSING");
  else flags.delete("VISUAL_MISSING");

  await ctx.db
    .update(schema.contentVariants)
    .set({
      slidesJson: slides,
      flags: [...flags],
      lockVersion: sql`${schema.contentVariants.lockVersion} + 1`,
    })
    .where(eq(schema.contentVariants.id, variantId));
  await audit(ctx, {
    action: "variant.visual_assets_generated",
    entityType: "content_variant",
    entityId: variantId,
    marketId: variant.marketId,
    data: {
      generated: outcomes.filter((o) => o.status === "GENERATED").length,
      reused: outcomes.filter((o) => o.status === "REUSED").length,
      failed: outcomes.filter((o) => o.status === "FAILED").length,
      visualMissing,
    },
  });
  if (transient) throw transient;
  return { variantId, outcomes, costUsd, visualMissing };
}
