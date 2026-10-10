import { createHash } from "node:crypto";
import { schema } from "@rc/db";
import type { Slide, VisualBrief } from "@rc/db/json";
import { eq, inArray } from "@rc/db/orm";
import { InvalidStateError, NotFoundError } from "@rc/lib/errors";
import { registry } from "@rc/templates";
import { buildTheme, type RenderAssets, type Theme } from "@rc/templates/render";
import { z } from "zod";
import { type ServiceContext, triggerJob } from "../core";

// What a render is made of and the hash that says whether it is already made (plan 06 J8 step 1,
// M3-12). No browser here: the web app may compute the hash and queue the job.

export const RenderCarouselPayload = z.object({ variantId: z.uuid() });
export type RenderCarouselPayload = z.infer<typeof RenderCarouselPayload>;

/** Text edits wait this long, so several quick edits make one render (06 J8). */
export const RENDER_DEBOUNCE_SECONDS = 10;

const RENDERABLE = ["READY_FOR_REVIEW", "CHANGES_REQUESTED"];

export type RenderInput = {
  variant: typeof schema.contentVariants.$inferSelect;
  slides: Slide[];
  theme: Theme;
  /** Ready asset rows used by the slides, by id. */
  assets: Map<string, typeof schema.visualAssets.$inferSelect>;
  templatesVersion: string;
  inputHash: string;
};

/** The `templates_version` of a render: every template version that the slides use. */
export function templatesVersionOf(slides: readonly Slide[]): string {
  const ids = [...new Set(slides.map((s) => s.templateId))].sort();
  return ids.map((id) => `${id}@${registry.get(id)?.version ?? "?"}`).join(",");
}

export async function loadRenderInput(
  ctx: ServiceContext,
  variantId: string,
): Promise<RenderInput> {
  const [variant] = await ctx.db
    .select()
    .from(schema.contentVariants)
    .where(eq(schema.contentVariants.id, variantId));
  if (!variant) throw new NotFoundError("Variant not found.", { details: { variantId } });
  if (!RENDERABLE.includes(variant.status)) {
    throw new InvalidStateError(`A ${variant.status} variant is not rendered again.`, {
      details: { variantId, status: variant.status },
    });
  }
  if (variant.slidesJson.length === 0) {
    throw new InvalidStateError("The variant has no slides yet.", { details: { variantId } });
  }

  const [idea] = await ctx.db
    .select({ brandId: schema.masterIdeas.brandId })
    .from(schema.masterIdeas)
    .where(eq(schema.masterIdeas.id, variant.masterIdeaId));
  const [brand] = await ctx.db
    .select({ visualSystem: schema.brands.visualSystem })
    .from(schema.brands)
    .where(eq(schema.brands.id, idea?.brandId ?? ""));
  const [market] = await ctx.db
    .select({ visualHypotheses: schema.markets.visualHypotheses })
    .from(schema.markets)
    .where(eq(schema.markets.id, variant.marketId));
  // The theme variant of the hypothesis the visual brief applied, if it names one.
  const brief: VisualBrief | null = variant.visualBriefJson;
  const hypothesis = (market?.visualHypotheses ?? []).find((h) => h.id === brief?.hypothesisId);
  const theme = buildTheme(brand?.visualSystem ?? {}, hypothesis?.themeVariant ?? null);

  const assetIds = [
    ...new Set(
      variant.slidesJson.flatMap((s) =>
        Object.values(s.images).flatMap((i) => (i.assetId ? [i.assetId] : [])),
      ),
    ),
  ];
  const rows = assetIds.length
    ? await ctx.db
        .select()
        .from(schema.visualAssets)
        .where(inArray(schema.visualAssets.id, assetIds))
    : [];
  const assets = new Map(
    rows.filter((r) => r.status === "READY" && r.storageKey).map((r) => [r.id, r]),
  );

  const templatesVersion = templatesVersionOf(variant.slidesJson);
  const inputHash = createHash("sha256")
    .update(
      JSON.stringify([
        variant.slidesJson.map((s) => [
          s.id,
          s.templateId,
          Object.entries(s.slots).sort(),
          Object.entries(s.images)
            .sort()
            .map(([slot, i]) => [
              slot,
              i.assetId ?? null,
              i.assetId ? (assets.get(i.assetId)?.storageKey ?? null) : null,
            ]),
        ]),
        theme,
        templatesVersion,
      ]),
    )
    .digest("hex");
  return { variant, slides: variant.slidesJson, theme, assets, templatesVersion, inputHash };
}

/**
 * Queues a render of the variant. The key holds the input hash, so a second request for the same
 * content is one run; `delaySeconds` debounces text edits.
 */
export async function requestRender(
  ctx: ServiceContext,
  variantId: string,
  options: { delaySeconds?: number } = {},
): Promise<{ jobRunId: string; inputHash: string }> {
  const { inputHash } = await loadRenderInput(ctx, variantId);
  const { runId } = await triggerJob(
    ctx,
    "render-carousel",
    { variantId },
    {
      idempotencyKey: `render:${variantId}:${inputHash}`,
      ...(options.delaySeconds ? { delaySeconds: options.delaySeconds } : {}),
    },
  );
  return { jobRunId: runId, inputHash };
}

/** Image assets of the slides as data URLs, for the page (no network at render time). */
export async function loadRenderAssets(
  ctx: ServiceContext,
  input: RenderInput,
): Promise<{ assets: RenderAssets }[]> {
  const logo = await loadLogo(ctx, input.theme);
  return Promise.all(
    input.slides.map(async (slide) => {
      const images: Record<string, string> = {};
      for (const [slot, ref] of Object.entries(slide.images)) {
        const asset = ref.assetId ? input.assets.get(ref.assetId) : undefined;
        if (!asset?.storageKey) continue;
        const bytes = await ctx.storage.getBytes(asset.storageKey);
        images[slot] =
          `data:${asset.mimeType ?? "image/webp"};base64,${Buffer.from(bytes).toString("base64")}`;
      }
      return { assets: { images, ...(logo ? { logo } : {}) } };
    }),
  );
}

const LOGO_MIME: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

async function loadLogo(ctx: ServiceContext, theme: Theme): Promise<string | undefined> {
  const key = theme.logo.assetKey;
  if (!key) return undefined;
  const mime = LOGO_MIME[key.split(".").at(-1)?.toLowerCase() ?? ""] ?? "image/png";
  const bytes = await ctx.storage.getBytes(key);
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}
