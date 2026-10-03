import { schema } from "@rc/db";
import { and, eq, inArray } from "@rc/db/orm";
import { ForbiddenError, InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import { type ServiceContext, transition, triggerJob, withTransaction } from "../../core";
import { canProcessWithAI } from "../rights";

export const ReprocessSourceInput = z.object({
  sourceAssetId: z.uuid(),
  /** FULL parses the file again; KNOWLEDGE_ONLY keeps the pages and extracts again. */
  mode: z.enum(["FULL", "KNOWLEDGE_ONLY"]).default("FULL"),
});

/**
 * `reprocessSource` (owner, editor; plan 05 §5.3): attempt + 1, the old attempt's unapproved cards
 * become ARCHIVED (`SUPERSEDED`), approved cards stay, then `ingest-source` runs again. Only a
 * READY or FAILED source can be reprocessed; a BLOCKED one is released by `updateSourceRights`.
 */
export async function reprocessSource(
  ctx: ServiceContext,
  raw: z.input<typeof ReprocessSourceInput>,
): Promise<{ jobRunId: string; attempt: number }> {
  if (ctx.actor.type === "USER" && !["owner", "editor"].includes(ctx.actor.role)) {
    throw new ForbiddenError();
  }
  const parsed = ReprocessSourceInput.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const { sourceAssetId, mode } = parsed.data;

  const [source] = await ctx.db
    .select()
    .from(schema.sourceAssets)
    .where(eq(schema.sourceAssets.id, sourceAssetId));
  if (!source) throw new NotFoundError("Source not found.", { details: { sourceAssetId } });
  if (source.archivedAt) throw new InvalidStateError("This source is archived.");
  if (!canProcessWithAI(source)) {
    throw new InvalidStateError(
      "AI processing is not allowed for this source; confirm its rights first.",
    );
  }

  const attempt = source.processingAttempt + 1;
  const superseded = await withTransaction(ctx, async (tx) => {
    // Status first: it refuses anything but READY or FAILED, before any card is touched.
    await transition(tx, {
      table: schema.sourceAssets,
      statusKey: "processingStatus",
      id: sourceAssetId,
      from: ["READY", "FAILED"],
      to: "QUEUED",
      set: { processingAttempt: attempt, processingProgress: {}, processingError: null },
      audit: {
        action: "source.reprocessed",
        entityType: "source_asset",
        data: { attempt, mode },
      },
    });
    const old = await tx.db
      .select({ id: schema.knowledgeItems.id })
      .from(schema.knowledgeItems)
      .where(
        and(
          eq(schema.knowledgeItems.sourceAssetId, sourceAssetId),
          eq(schema.knowledgeItems.origin, "SOURCE_EXTRACTED"),
          inArray(schema.knowledgeItems.reviewStatus, ["EXTRACTED", "NEEDS_REVIEW"]),
        ),
      );
    for (const card of old) {
      await transition(tx, {
        table: schema.knowledgeItems,
        statusKey: "reviewStatus",
        id: card.id,
        from: ["EXTRACTED", "NEEDS_REVIEW"],
        to: "ARCHIVED",
        set: { archiveReason: "SUPERSEDED" },
        audit: {
          action: "knowledge.archived",
          entityType: "knowledge_item",
          data: { reason: "SUPERSEDED", attempt },
        },
      });
    }
    return old.length;
  });
  ctx.logger.info({ sourceAssetId, attempt, superseded }, "source reprocess queued");

  const { runId } = await triggerJob(
    ctx,
    "ingest-source",
    { sourceAssetId, attempt, mode },
    { idempotencyKey: `ingest:${sourceAssetId}:${attempt}` },
  );
  return { jobRunId: runId, attempt };
}
