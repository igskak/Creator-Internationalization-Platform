import { randomUUID } from "node:crypto";
import { schema } from "@rc/db";
import type { VisualBrief } from "@rc/db/json";
import { and, eq, inArray, sql } from "@rc/db/orm";
import { InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import { runStage } from "../../ai";
import { audit, type ServiceContext, triggerJob } from "../../core";
import { getIdeaCards } from "../../knowledge/retrieval";
import { p0Registry } from "../pipeline/context";
import { loadLibraryCandidates, loadVisualStyles } from "./context";
import { type SiblingVisual, visualInput, visualValidationContext } from "./inputs";
import { finishPhotoPrompts } from "./photo-prompt";
import { validateVisualBrief } from "./validate";

export const RegenerateVisualBriefInput = z.object({ variantId: z.uuid() });

/** Statuses whose pictures a person can still change (the text is edited in the same ones). */
const EDITABLE = ["READY_FOR_REVIEW", "CHANGES_REQUESTED"];

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
  if (!EDITABLE.includes(variant.status)) {
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
    .where(
      and(
        eq(schema.contentVariants.masterIdeaId, variant.masterIdeaId),
        eq(schema.contentVariants.format, "CAROUSEL"),
      ),
    );
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
      // The same recipe as at generation: the idea's approved cards.
      cards: await getIdeaCards(ctx, idea.id),
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

  const brief = finishPhotoPrompts(result.data, slides, p0Registry);
  await ctx.db
    .update(schema.contentVariants)
    .set({
      visualBriefJson: brief,
      visualStyle: brief.visualStyle,
      lockVersion: sql`${schema.contentVariants.lockVersion} + 1`,
    })
    .where(eq(schema.contentVariants.id, variantId));
  await audit(ctx, {
    action: "variant.visual_brief_regenerated",
    entityType: "content_variant",
    entityId: variantId,
    marketId: variant.marketId,
    data: { runId: result.runId, slots: brief.slides.length },
  });
  return { visualBrief: brief };
}

// "Regenerate pictures" of the review screen: the pictures of ONE variant are planned again from
// its current slides (the text a person may have edited stays as it is) and drawn anew. The
// action only checks and queues the job; the job replans (one visual director call) and hands the
// drawing to J7, which queues the render. Far cheaper than "Regenerate all", which rewrites the
// text of every market too.

export const RegenerateVisualsInput = z.object({ variantId: z.uuid() });

/** J22 payload. `requestId` identifies the request: the same one is one run. */
export const RegenerateVisualsPayload = z.object({
  variantId: z.uuid(),
  requestId: z.uuid(),
});
export type RegenerateVisualsPayload = z.infer<typeof RegenerateVisualsPayload>;

/** The `regenerateVisuals` action: checks the variant and queues J22. Nothing is written yet. */
export async function requestVisualsRegeneration(
  ctx: ServiceContext,
  raw: z.input<typeof RegenerateVisualsInput>,
): Promise<{ jobRunId: string; requestId: string }> {
  const parsed = RegenerateVisualsInput.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const { variantId } = parsed.data;
  const [variant] = await ctx.db
    .select({
      status: schema.contentVariants.status,
      slides: schema.contentVariants.slidesJson,
      marketId: schema.contentVariants.marketId,
    })
    .from(schema.contentVariants)
    .where(eq(schema.contentVariants.id, variantId));
  if (!variant) throw new NotFoundError("Variant not found.", { details: { variantId } });
  if (!EDITABLE.includes(variant.status)) {
    throw new InvalidStateError(
      `The pictures of a ${variant.status} variant cannot be redone. Withdraw the approval first.`,
      { details: { variantId, status: variant.status } },
    );
  }
  if (variant.slides.length === 0) {
    throw new InvalidStateError("The variant has no slides yet.", { details: { variantId } });
  }

  const requestId = randomUUID();
  await audit(ctx, {
    action: "variant.visuals_regeneration_requested",
    entityType: "content_variant",
    entityId: variantId,
    marketId: variant.marketId,
    data: { requestId },
  });
  const { runId } = await triggerJob(
    ctx,
    "regenerate-visuals",
    { variantId, requestId },
    { idempotencyKey: `regen-visuals:${requestId}` },
  );
  return { jobRunId: runId, requestId };
}

/**
 * J22 `regenerate-visuals`: plans the pictures again and queues J7 for every slot of the new brief.
 * New prompts mean new pictures; a slot whose prompt came out the same keeps its picture (J7 never
 * pays twice for one prompt). A brief that does not pass the checks keeps the old pictures and
 * fails the run with the issues.
 */
export async function runVisualsRegeneration(
  ctx: ServiceContext,
  raw: RegenerateVisualsPayload,
): Promise<{ jobRunId: string; slots: number }> {
  const { variantId, requestId } = RegenerateVisualsPayload.parse(raw);
  const { visualBrief } = await regenerateVisualBrief(ctx, { variantId });
  const { runId } = await triggerJob(
    ctx,
    "generate-visual-assets",
    { variantId },
    { idempotencyKey: `regen-visuals-assets:${requestId}` },
  );
  return { jobRunId: runId, slots: visualBrief.slides.length };
}
