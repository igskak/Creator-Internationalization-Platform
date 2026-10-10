import { schema } from "@rc/db";
import type { VisualBrief } from "@rc/db/json";
import { eq, inArray, sql } from "@rc/db/orm";
import { InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import { runStage } from "../../ai";
import { audit, type ServiceContext } from "../../core";
import { p0Registry } from "../pipeline/context";
import { loadLibraryCandidates, loadVisualStyles } from "./context";
import { type SiblingVisual, visualInput, visualValidationContext } from "./inputs";
import { validateVisualBrief } from "./validate";

export const RegenerateVisualBriefInput = z.object({ variantId: z.uuid() });

/**
 * The `regenerateVisualBrief` action (M3-02): plans the pictures of one variant again from its
 * current slides, with the other markets' briefs as siblings. Only a variant a person can still
 * edit; its text is not touched. Returns the new brief; a brief that does not pass the validators
 * leaves the old one in place and reports the issues.
 */
export async function regenerateVisualBrief(
  ctx: ServiceContext,
  raw: z.input<typeof RegenerateVisualBriefInput>,
): Promise<{ visualBrief: VisualBrief }> {
  const parsed = RegenerateVisualBriefInput.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const { variantId } = parsed.data;

  const [variant] = await ctx.db
    .select()
    .from(schema.contentVariants)
    .where(eq(schema.contentVariants.id, variantId));
  if (!variant) throw new NotFoundError("Variant not found.", { details: { variantId } });
  if (!["READY_FOR_REVIEW", "CHANGES_REQUESTED"].includes(variant.status)) {
    throw new InvalidStateError(
      `The pictures of a ${variant.status} variant cannot be replanned.`,
      {
        details: { variantId, status: variant.status },
      },
    );
  }
  if (variant.slidesJson.length === 0) {
    throw new InvalidStateError("The variant has no slides yet.", { details: { variantId } });
  }

  const [idea] = await ctx.db
    .select()
    .from(schema.masterIdeas)
    .where(eq(schema.masterIdeas.id, variant.masterIdeaId));
  const [market] = await ctx.db
    .select()
    .from(schema.markets)
    .where(eq(schema.markets.id, variant.marketId));
  if (!idea || !market) throw new NotFoundError("The idea or the market is missing.");

  const siblings: SiblingVisual[] = [];
  const others = await ctx.db
    .select({
      brief: schema.contentVariants.visualBriefJson,
      marketCode: schema.markets.code,
      id: schema.contentVariants.id,
      status: schema.contentVariants.status,
    })
    .from(schema.contentVariants)
    .innerJoin(schema.markets, eq(schema.markets.id, schema.contentVariants.marketId))
    .where(eq(schema.contentVariants.masterIdeaId, variant.masterIdeaId));
  for (const o of others) {
    if (o.id !== variantId && o.status !== "REJECTED" && o.brief) {
      siblings.push({ marketCode: o.marketCode, brief: o.brief });
    }
  }

  const visualStyles = await loadVisualStyles(ctx);
  const library = await loadLibraryCandidates(ctx);
  const hypotheses = market.visualHypotheses;
  const slides = variant.slidesJson;
  const result = await runStage<VisualBrief>(ctx, {
    stage: "VISUAL_DIRECTION",
    input: visualInput({
      idea,
      market: { code: market.code, displayName: market.displayName, hypotheses },
      slides,
      templates: p0Registry,
      library,
      siblings,
      visualStyles,
    }),
    inputRefs: { masterIdeaId: idea.id, variantId },
    validate: (output) =>
      validateVisualBrief(
        output,
        visualValidationContext({
          slides,
          templates: p0Registry,
          library,
          visualStyles,
          hypotheses,
        }),
      ),
  });
  await ctx.db
    .update(schema.generationRuns)
    .set({ masterIdeaId: idea.id, contentVariantId: variantId })
    .where(inArray(schema.generationRuns.id, result.runIds));
  if (!result.data) {
    throw new InvalidStateError("The visual director gave no usable brief. Try again.", {
      details: { status: result.status, issues: result.issues.slice(0, 10) },
    });
  }

  await ctx.db
    .update(schema.contentVariants)
    .set({
      visualBriefJson: result.data,
      visualStyle: result.data.visualStyle,
      lockVersion: sql`${schema.contentVariants.lockVersion} + 1`,
    })
    .where(eq(schema.contentVariants.id, variantId));
  await audit(ctx, {
    action: "variant.visual_brief_regenerated",
    entityType: "content_variant",
    entityId: variantId,
    marketId: variant.marketId,
    data: { runId: result.runId, slots: result.data.slides.length },
  });
  return { visualBrief: result.data };
}
