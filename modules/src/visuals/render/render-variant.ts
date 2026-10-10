import { schema } from "@rc/db";
import type { VariantFlag } from "@rc/db/json";
import { and, eq, sql } from "@rc/db/orm";
import { audit, type ServiceContext } from "../../core";
import { loadRenderAssets, loadRenderInput } from "../render-input";
import { type RenderOptions, renderCarousel } from "./renderer";

// The `render-carousel` job (plan 06 J8, M3-12): renders a variant's slides, stores the JPEGs, the
// QA report and the flags, and points the variant at the new render. A render of the same input
// is reused, so a retry or a second request costs nothing.

/** Flags this job owns; it clears the ones the new render no longer finds. */
const RENDER_FLAGS: VariantFlag[] = [
  "TEXT_OVERFLOW",
  "MISSING_GLYPH",
  "RENDER_FAILED",
  "VISUAL_MISSING",
];

export type RenderVariantResult = {
  variantId: string;
  renderId: string;
  inputHash: string;
  reused: boolean;
  status: "READY" | "FAILED";
  flags: VariantFlag[];
  problems: string[];
};

export async function renderVariantCarousel(
  ctx: ServiceContext,
  { variantId }: { variantId: string },
  options: RenderOptions = {},
): Promise<RenderVariantResult> {
  const input = await loadRenderInput(ctx, variantId);
  const { variant, inputHash } = input;

  const setFlags = async (flags: readonly VariantFlag[], currentRenderId?: string) => {
    const kept = (variant.flags as VariantFlag[]).filter((f) => !RENDER_FLAGS.includes(f));
    await ctx.db
      .update(schema.contentVariants)
      .set({
        flags: [...new Set([...kept, ...flags])],
        ...(currentRenderId ? { currentRenderId } : {}),
        lockVersion: sql`${schema.contentVariants.lockVersion} + 1`,
      })
      .where(eq(schema.contentVariants.id, variantId));
  };

  // 1. The same input was rendered before: make it current and stop.
  const [existing] = await ctx.db
    .select()
    .from(schema.carouselRenders)
    .where(
      and(
        eq(schema.carouselRenders.contentVariantId, variantId),
        eq(schema.carouselRenders.inputHash, inputHash),
      ),
    );
  if (existing?.status === "READY") {
    if (variant.currentRenderId !== existing.id) {
      await ctx.db
        .update(schema.contentVariants)
        .set({ currentRenderId: existing.id })
        .where(eq(schema.contentVariants.id, variantId));
    }
    return {
      variantId,
      renderId: existing.id,
      inputHash,
      reused: true,
      status: "READY",
      flags: [],
      problems: [],
    };
  }

  // 2. A new render row, or the failed one of the same input, started again.
  const base = {
    status: "RENDERING" as const,
    templatesVersion: input.templatesVersion,
    slideCount: input.slides.length,
    error: null,
    qaReport: null,
    completedAt: null,
  };
  const [row] = existing
    ? await ctx.db
        .update(schema.carouselRenders)
        .set(base)
        .where(eq(schema.carouselRenders.id, existing.id))
        .returning()
    : await ctx.db
        .insert(schema.carouselRenders)
        .values({ contentVariantId: variantId, inputHash, ...base })
        .returning();
  const renderId = row?.id ?? "";

  try {
    const assets = await loadRenderAssets(ctx, input);
    const result = await renderCarousel(
      {
        slides: input.slides.map((slide, i) => ({
          slide,
          assets: (assets[i] as (typeof assets)[number]).assets,
        })),
        theme: input.theme,
      },
      options,
    );

    if (result.slides.length === 0) {
      // Stopped on a missing glyph: no picture, but the report says which characters.
      await ctx.db
        .update(schema.carouselRenders)
        .set({
          status: "FAILED",
          qaReport: result.qa,
          error: { code: "MISSING_GLYPH", message: result.verdict.problems.join(" ") },
          completedAt: ctx.clock.now(),
        })
        .where(eq(schema.carouselRenders.id, renderId));
      await setFlags(result.verdict.flags);
      await audit(ctx, {
        action: "variant.render_failed",
        entityType: "content_variant",
        entityId: variantId,
        marketId: variant.marketId,
        data: { renderId, flags: result.verdict.flags },
      });
      return {
        variantId,
        renderId,
        inputHash,
        reused: false,
        status: "FAILED",
        flags: result.verdict.flags,
        problems: result.verdict.problems,
      };
    }

    for (const slide of result.slides) {
      const key = `renders/${variantId}/${renderId}/${slide.index}.jpg`;
      await ctx.storage.put(key, slide.jpeg, { contentType: "image/jpeg" });
      await ctx.db
        .insert(schema.renderedSlides)
        .values({
          carouselRenderId: renderId,
          slideIndex: slide.index,
          slideId: slide.slideId,
          templateId: slide.templateId,
          storageKey: key,
          width: slide.width,
          height: slide.height,
          bytes: slide.bytes,
          sha256: slide.sha256,
        })
        .onConflictDoNothing();
    }
    await ctx.db
      .update(schema.carouselRenders)
      .set({ status: "READY", qaReport: result.qa, completedAt: ctx.clock.now() })
      .where(eq(schema.carouselRenders.id, renderId));
    await setFlags(result.verdict.flags, renderId);
    await audit(ctx, {
      action: "variant.rendered",
      entityType: "content_variant",
      entityId: variantId,
      marketId: variant.marketId,
      data: { renderId, flags: result.verdict.flags, slides: result.slides.length },
    });
    return {
      variantId,
      renderId,
      inputHash,
      reused: false,
      status: "READY",
      flags: result.verdict.flags,
      problems: result.verdict.problems,
    };
  } catch (error) {
    // A crash of the browser or of storage: the render is FAILED and flagged, and the job is retried.
    const message = error instanceof Error ? error.message : String(error);
    await ctx.db
      .update(schema.carouselRenders)
      .set({
        status: "FAILED",
        error: { code: "RENDER_FAILED", message },
        completedAt: ctx.clock.now(),
      })
      .where(eq(schema.carouselRenders.id, renderId));
    await setFlags(["RENDER_FAILED"]);
    throw error;
  }
}
