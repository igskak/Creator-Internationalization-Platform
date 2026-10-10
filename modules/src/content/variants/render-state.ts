import { schema } from "@rc/db";
import { desc, eq } from "@rc/db/orm";
import type { ServiceContext } from "../../core";
import { loadRenderInput } from "../../visuals";
import type { RenderState } from "./state";

type Variant = typeof schema.contentVariants.$inferSelect;
type Render = typeof schema.carouselRenders.$inferSelect;

/**
 * Whether the variant's carousel images show its current content (plan 08 §8.5): READY when the
 * current render was made from the same input, STALE when the content changed since, RENDERING
 * while one runs, FAILED when the last one failed, NONE before any render. Same rule as the
 * review screen's `RenderView`, without the presigned URLs.
 */
export async function currentRenderState(
  ctx: ServiceContext,
  variant: Variant,
): Promise<{ state: RenderState; current: Render | null }> {
  if (variant.slidesJson.length === 0) return { state: "NONE", current: null };
  const [latest] = await ctx.db
    .select()
    .from(schema.carouselRenders)
    .where(eq(schema.carouselRenders.contentVariantId, variant.id))
    .orderBy(desc(schema.carouselRenders.createdAt))
    .limit(1);
  const [current] = variant.currentRenderId
    ? await ctx.db
        .select()
        .from(schema.carouselRenders)
        .where(eq(schema.carouselRenders.id, variant.currentRenderId))
    : [];
  const inFlight = latest !== undefined && ["PENDING", "RENDERING"].includes(latest.status);
  if (!current || current.status !== "READY") {
    if (inFlight) return { state: "RENDERING", current: null };
    if (latest?.status === "FAILED") return { state: "FAILED", current: null };
    return { state: "NONE", current: null };
  }
  const fresh = await loadRenderInput(ctx, variant.id)
    .then((input) => input.inputHash === current.inputHash)
    .catch(() => true);
  return { state: fresh ? "READY" : inFlight ? "RENDERING" : "STALE", current };
}
