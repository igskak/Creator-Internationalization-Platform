import { schema } from "@rc/db";
import type { CriticReport } from "@rc/db/json";
import { asc, eq, inArray } from "@rc/db/orm";
import { InvalidStateError, NotFoundError } from "@rc/lib/errors";
import type { LLMContent } from "@rc/lib/providers/llm";
import type { visualQa } from "@rc/prompts";
import { z } from "zod";
import { runStage } from "../ai";
import { audit, type ServiceContext } from "../core";

// Visual QA with a vision model (plan 07 §7.6.1, M3-17): the rendered JPEGs of a variant go to
// `visual-qa@1`, which reports what the deterministic render checks cannot see: legibility against
// the picture, AI artifacts, text inside the pictures, brand look, composition. The findings are
// added to the variant's critic report (categories `VISUAL_*`, severity MAJOR or MINOR: a model
// that looks at pictures does not block an approval); the previous visual findings are replaced.

export const RunVisualQaPayload = z.object({ variantId: z.uuid() });
export type RunVisualQaPayload = z.infer<typeof RunVisualQaPayload>;

export type VisualQaResult = {
  variantId: string;
  /** Slides whose JPEG was sent to the model. */
  checked: string[];
  /** Slides left out because a library photo on them may not go to a model (rights). */
  skipped: string[];
  issues: number;
  /** False when the variant has no critic report to add the findings to. */
  reported: boolean;
  costUsd: number | null;
};

const VISUAL_PREFIX = "VISUAL_";

export async function runVisualQa(
  ctx: ServiceContext,
  raw: z.input<typeof RunVisualQaPayload>,
): Promise<VisualQaResult> {
  const { variantId } = RunVisualQaPayload.parse(raw);
  const [variant] = await ctx.db
    .select()
    .from(schema.contentVariants)
    .where(eq(schema.contentVariants.id, variantId));
  if (!variant) throw new NotFoundError("Variant not found.", { details: { variantId } });
  if (!["READY_FOR_REVIEW", "CHANGES_REQUESTED"].includes(variant.status)) {
    throw new InvalidStateError(`A ${variant.status} variant is not checked again.`, {
      details: { variantId, status: variant.status },
    });
  }
  if (!variant.currentRenderId) {
    throw new InvalidStateError("The variant has no render to look at yet.", {
      details: { variantId },
    });
  }
  const [render] = await ctx.db
    .select({ status: schema.carouselRenders.status })
    .from(schema.carouselRenders)
    .where(eq(schema.carouselRenders.id, variant.currentRenderId));
  if (render?.status !== "READY") {
    throw new InvalidStateError("The current render is not ready.", { details: { variantId } });
  }
  const files = await ctx.db
    .select()
    .from(schema.renderedSlides)
    .where(eq(schema.renderedSlides.carouselRenderId, variant.currentRenderId))
    .orderBy(asc(schema.renderedSlides.slideIndex));

  // A library photo whose source does not allow AI processing must not be sent to a model, and a
  // rendered slide shows it: those slides are left out.
  const assetIds = variant.slidesJson.flatMap((s) =>
    Object.values(s.images).flatMap((i) => (i.assetId ? [i.assetId] : [])),
  );
  const rows = assetIds.length
    ? await ctx.db
        .select({
          id: schema.visualAssets.id,
          kind: schema.visualAssets.kind,
          source: schema.sourceAssets,
        })
        .from(schema.visualAssets)
        .leftJoin(
          schema.sourceAssets,
          eq(schema.sourceAssets.id, schema.visualAssets.sourceAssetId),
        )
        .where(inArray(schema.visualAssets.id, assetIds))
    : [];
  const noAi = new Set(
    rows
      .filter(
        (r) =>
          r.kind === "LIBRARY_PHOTO" &&
          (!r.source ||
            r.source.rights.aiProcessing !== "ALLOWED" ||
            r.source.rightsStatus === "RESTRICTED"),
      )
      .map((r) => r.id),
  );
  const blocked = (slideId: string) =>
    Object.values(variant.slidesJson.find((s) => s.id === slideId)?.images ?? {}).some(
      (i) => i.assetId && noAi.has(i.assetId),
    );
  const sent = files.filter((f) => !blocked(f.slideId));
  const skipped = files.filter((f) => blocked(f.slideId)).map((f) => f.slideId);
  if (sent.length === 0) {
    return { variantId, checked: [], skipped, issues: 0, reported: false, costUsd: 0 };
  }

  const [market] = await ctx.db
    .select({ code: schema.markets.code, displayName: schema.markets.displayName })
    .from(schema.markets)
    .where(eq(schema.markets.id, variant.marketId));
  const [idea] = await ctx.db
    .select({ brandId: schema.masterIdeas.brandId })
    .from(schema.masterIdeas)
    .where(eq(schema.masterIdeas.id, variant.masterIdeaId));
  const [brand] = await ctx.db
    .select({ brandVoice: schema.brands.brandVoice })
    .from(schema.brands)
    .where(eq(schema.brands.id, idea?.brandId ?? ""));

  const attachments: LLMContent[] = await Promise.all(
    sent.map(async (f) => ({
      type: "image" as const,
      mediaType: "image/jpeg" as const,
      base64: Buffer.from(await ctx.storage.getBytes(f.storageKey)).toString("base64"),
    })),
  );
  const slides = sent.map((f, i) => {
    const slide = variant.slidesJson.find((s) => s.id === f.slideId);
    return {
      slideId: f.slideId,
      index: i,
      role: slide?.role ?? "OTHER",
      templateId: f.templateId,
      texts: Object.entries(slide?.slots ?? {}).map(([slot, text]) => ({ slot, text })),
    };
  });
  const known = new Set(sent.map((f) => f.slideId));

  const result = await runStage<visualQa.VisualQaOutput>(ctx, {
    stage: "VISUAL_QA",
    input: {
      market: { code: market?.code ?? "", displayName: market?.displayName ?? "" },
      brandVoice: brand?.brandVoice ?? "",
      slides,
    },
    attachments,
    inputRefs: { masterIdeaId: variant.masterIdeaId, variantId },
    validate: (output) =>
      output.issues.flatMap((issue, i) =>
        known.has(issue.slideId)
          ? []
          : [
              {
                severity: "BLOCKER" as const,
                code: "SLIDE_UNKNOWN",
                fieldPath: `issues.${i}.slideId`,
                message: `"${issue.slideId}" is not a slide of the task.`,
                fixHint: "Use the slide ids given in <slides>.",
              },
            ],
      ),
  });
  await ctx.db
    .update(schema.generationRuns)
    .set({ masterIdeaId: variant.masterIdeaId, contentVariantId: variantId })
    .where(inArray(schema.generationRuns.id, result.runIds));
  if (!result.data) {
    throw new InvalidStateError("The visual check gave no usable answer. Try again.", {
      details: { status: result.status, issues: result.issues.slice(0, 10) },
    });
  }

  const found = result.data.issues.map((i) => ({
    severity: i.severity,
    category: `${VISUAL_PREFIX}${i.category}`,
    fieldPath: `slides.${i.slideId}`,
    explanation: i.explanation,
    ...(i.suggestedFix.trim() ? { suggestedFix: i.suggestedFix } : {}),
  }));
  const report = variant.criticReport;
  if (report) {
    const updated: CriticReport = {
      ...report,
      issues: [...report.issues.filter((i) => !i.category.startsWith(VISUAL_PREFIX)), ...found],
    };
    await ctx.db
      .update(schema.contentVariants)
      .set({ criticReport: updated })
      .where(eq(schema.contentVariants.id, variantId));
  }
  await audit(ctx, {
    action: "variant.visual_qa",
    entityType: "content_variant",
    entityId: variantId,
    marketId: variant.marketId,
    data: { checked: sent.length, skipped: skipped.length, issues: found.length },
  });
  return {
    variantId,
    checked: sent.map((f) => f.slideId),
    skipped,
    issues: found.length,
    reported: Boolean(report),
    costUsd: result.costUsd,
  };
}
