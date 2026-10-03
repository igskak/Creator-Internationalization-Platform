import { schema } from "@rc/db";
import { SourceReference } from "@rc/db/json";
import { and, asc, between, count, eq } from "@rc/db/orm";
import { NotFoundError, PermanentError } from "@rc/lib/errors";
import type { knowledgeExtractor } from "@rc/prompts";
import { runStage, type StageResult } from "../../ai";
import { type ServiceContext, transition, withTransaction } from "../../core";
import { assertCanProcessWithAI } from "../rights";
import { assessCard } from "./assess";
import { cutPdf, MAX_SUB_PDF_BYTES } from "./plan";
import { loadExtractionTaxonomy } from "./taxonomy";
import { validateExtraction } from "./validate";

// J2 `extract-knowledge-batch` (plan 06 §6.3, 07 §7.2.3): one page range of one source →
// validated, checked cards in the review queue (quote, number and safety checks: ./assess).
// Embeddings and dedupe are M1-16.

type Output = knowledgeExtractor.ExtractorOutput;
type Batch = typeof schema.knowledgeExtractionBatches.$inferSelect;

export type BatchOutcome = {
  batchId: string;
  status: "SUCCEEDED" | "SKIPPED" | "FAILED";
  /** Cards stored for this batch (after a rerun: all of them). */
  cardsCreated: number;
  /** The mode that produced the cards (TEXT after a fallback). */
  mode: "PDF_NATIVE" | "TEXT";
  fallbackUsed: boolean;
  /** Reason when status is FAILED or SKIPPED. */
  reason?: string;
  runIds: string[];
};

export type ExtractBatchOptions = {
  /** Largest sub-PDF to send. Default 25 MB. */
  maxPdfBytes?: number;
};

/** Marks a batch FAILED with the reason; returns the outcome (no exception: the batch is done). */
async function failBatch(
  ctx: ServiceContext,
  batch: Batch,
  code: string,
  message: string,
  extra: {
    mode: Batch["mode"];
    fallbackUsed: boolean;
    runIds: string[];
    details?: Record<string, unknown>;
  },
): Promise<BatchOutcome> {
  await transition(ctx, {
    table: schema.knowledgeExtractionBatches,
    id: batch.id,
    from: ["RUNNING"],
    to: "FAILED",
    set: { error: { code, message, ...(extra.details ? { details: extra.details } : {}) } },
    audit: { entityType: "knowledge_extraction_batch", data: { code } },
  });
  ctx.logger.warn({ batchId: batch.id, code }, "extraction batch failed");
  return {
    batchId: batch.id,
    status: "FAILED",
    cardsCreated: 0,
    mode: extra.mode,
    fallbackUsed: extra.fallbackUsed,
    reason: code,
    runIds: extra.runIds,
  };
}

/**
 * Extracts the cards of one batch. Safe to run again: a SUCCEEDED batch is skipped, cards are
 * inserted by `(batch, ordinal)` and conflicts are ignored. A batch of an older processing attempt
 * is SKIPPED. Permanent failures (invalid output after the repair, refusal, an unusable PDF) are
 * returned as FAILED after one fallback to the page text; transient errors mark the batch FAILED
 * and are rethrown so the job runner retries (a FAILED batch may run again).
 */
export async function extractBatch(
  ctx: ServiceContext,
  input: { batchId: string },
  options: ExtractBatchOptions = {},
): Promise<BatchOutcome> {
  const [batch] = await ctx.db
    .select()
    .from(schema.knowledgeExtractionBatches)
    .where(eq(schema.knowledgeExtractionBatches.id, input.batchId));
  if (!batch) throw new NotFoundError("Extraction batch not found.", { details: input });
  const skipped = (status: "SKIPPED" | "SUCCEEDED", reason?: string): BatchOutcome => ({
    batchId: batch.id,
    status,
    cardsCreated: batch.cardsCreated,
    mode: batch.mode,
    fallbackUsed: false,
    ...(reason ? { reason } : {}),
    runIds: [],
  });
  if (batch.status === "SUCCEEDED" || batch.status === "SKIPPED") return skipped(batch.status);

  const [source] = await ctx.db
    .select()
    .from(schema.sourceAssets)
    .where(eq(schema.sourceAssets.id, batch.sourceAssetId));
  if (!source) throw new NotFoundError("Source not found.", { details: { batchId: batch.id } });
  assertCanProcessWithAI(source);

  if (batch.processingAttempt !== source.processingAttempt) {
    await transition(ctx, {
      table: schema.knowledgeExtractionBatches,
      id: batch.id,
      from: ["PENDING", "RUNNING", "FAILED"],
      to: "SKIPPED",
      audit: { entityType: "knowledge_extraction_batch", data: { reason: "STALE_ATTEMPT" } },
    });
    return skipped("SKIPPED", "STALE_ATTEMPT");
  }

  await transition(ctx, {
    table: schema.knowledgeExtractionBatches,
    id: batch.id,
    from: ["PENDING", "FAILED", "RUNNING"],
    to: "RUNNING",
    set: { error: null },
    audit: { entityType: "knowledge_extraction_batch", data: { mode: batch.mode } },
  });

  const range = { pageStart: batch.pageStart, pageEnd: batch.pageEnd };
  const pages = await ctx.db
    .select()
    .from(schema.sourcePages)
    .where(
      and(
        eq(schema.sourcePages.sourceAssetId, source.id),
        eq(schema.sourcePages.processingAttempt, batch.processingAttempt),
        between(schema.sourcePages.pageNumber, batch.pageStart, batch.pageEnd),
      ),
    )
    .orderBy(asc(schema.sourcePages.pageNumber));
  const textPages = pages.filter((p) => p.text.trim().length > 0);
  // Quote verification looks one page beyond the cited range (07 §7.2.4).
  const evidencePages = await ctx.db
    .select({ pageNumber: schema.sourcePages.pageNumber, text: schema.sourcePages.text })
    .from(schema.sourcePages)
    .where(
      and(
        eq(schema.sourcePages.sourceAssetId, source.id),
        eq(schema.sourcePages.processingAttempt, batch.processingAttempt),
        between(schema.sourcePages.pageNumber, batch.pageStart - 1, batch.pageEnd + 1),
      ),
    );
  const taxonomy = await loadExtractionTaxonomy(ctx);
  const runIds: string[] = [];

  const stageInput = (mode: "PDF_NATIVE" | "TEXT") => ({
    source: {
      title: source.title,
      type: source.type,
      ...(source.sourceAuthor ? { author: source.sourceAuthor } : {}),
      language: source.originalLanguage,
    },
    taxonomy,
    mode,
    ...range,
    ...(mode === "TEXT"
      ? {
          pages: textPages.map((p) => ({
            number: p.pageNumber,
            section: p.sectionPath,
            text: p.text,
          })),
        }
      : {}),
  });

  const run = async (
    mode: "PDF_NATIVE" | "TEXT",
    attachments?: { type: "pdf"; base64: string; title: string }[],
  ): Promise<StageResult<Output>> => {
    const result = await runStage<Output>(ctx, {
      stage: "KNOWLEDGE_EXTRACTION",
      input: stageInput(mode),
      ...(attachments ? { attachments } : {}),
      validate: (output) => validateExtraction(output, range),
      inputRefs: { sourceAssetId: source.id, pageRange: [batch.pageStart, batch.pageEnd] },
      sourceAssetId: source.id,
    });
    runIds.push(...result.runIds);
    return result;
  };

  /** PDF_NATIVE attempt: null means "could not be tried" (unusable PDF), with the reason. */
  const runPdf = async (): Promise<StageResult<Output> | { unusable: string }> => {
    if (!source.fileKey) return { unusable: "NO_FILE" };
    const sub = await cutPdf(
      await ctx.storage.getBytes(source.fileKey),
      batch.pageStart,
      batch.pageEnd,
    );
    if (sub.byteLength > (options.maxPdfBytes ?? MAX_SUB_PDF_BYTES)) {
      return { unusable: "SUB_PDF_TOO_LARGE" };
    }
    return run("PDF_NATIVE", [
      {
        type: "pdf",
        base64: Buffer.from(sub).toString("base64"),
        title: `${source.title}, pages ${batch.pageStart}–${batch.pageEnd}`,
      },
    ]);
  };

  try {
    let result: StageResult<Output> | undefined;
    let mode: "PDF_NATIVE" | "TEXT" = batch.mode;
    let fallbackReason: string | undefined;

    if (batch.mode === "PDF_NATIVE") {
      try {
        const attempt = await runPdf();
        if ("unusable" in attempt) fallbackReason = attempt.unusable;
        else if (attempt.status === "SUCCEEDED" || attempt.status === "REPAIRED") result = attempt;
        else fallbackReason = attempt.status;
      } catch (error) {
        // A transient error is the job runner's to retry; a permanent one (the API rejected the
        // PDF) is what the text fallback is for.
        if (!(error instanceof PermanentError)) throw error;
        fallbackReason = "PDF_REJECTED";
      }
    }
    if (!result) {
      if (batch.mode === "PDF_NATIVE" && textPages.length === 0) {
        return failBatch(
          ctx,
          batch,
          "PDF_FAILED_NO_TEXT",
          `PDF extraction failed (${fallbackReason}) and the pages have no text to fall back to.`,
          {
            mode: batch.mode,
            fallbackUsed: false,
            runIds,
            details: { reason: fallbackReason },
          },
        );
      }
      if (textPages.length === 0) {
        return failBatch(ctx, batch, "NO_TEXT", "The pages of this batch have no text.", {
          mode: batch.mode,
          fallbackUsed: false,
          runIds,
        });
      }
      mode = "TEXT";
      const attempt = await run("TEXT");
      if (attempt.status !== "SUCCEEDED" && attempt.status !== "REPAIRED") {
        return failBatch(ctx, batch, attempt.status, `Extraction ended as ${attempt.status}.`, {
          mode,
          fallbackUsed: batch.mode === "PDF_NATIVE",
          runIds,
          details: {
            ...(fallbackReason ? { pdfFailure: fallbackReason } : {}),
            ...(attempt.refusal ? { refusal: attempt.refusal } : {}),
            issues: attempt.issues.slice(0, 10),
          },
        });
      }
      result = attempt;
    }

    const cards = result.data?.cards ?? [];
    const cardsCreated = await withTransaction(ctx, async (tx) => {
      const inserted: string[] = [];
      for (const [ordinal, card] of cards.entries()) {
        const check = assessCard(card, evidencePages);
        const [row] = await tx.db
          .insert(schema.knowledgeItems)
          .values({
            brandId: source.brandId,
            title: card.title,
            category: card.category,
            subcategory: card.subcategory ?? null,
            claim: card.claim,
            explanation: card.explanation,
            procedureJson: card.procedure,
            ingredientsJson: card.ingredients,
            temperaturesJson: card.temperatures,
            timingsJson: card.timings,
            commonMistakesJson: card.commonMistakes,
            sourceAssetId: source.id,
            sourceReference: SourceReference.parse({
              pageStart: card.pageStart,
              pageEnd: card.pageEnd,
              ...(card.sectionHint ? { sectionPath: card.sectionHint } : {}),
              quote: card.sourceQuote,
              quoteVerified: check.quoteVerified,
              matchScore: check.matchScore,
              ...(check.notes.length ? { note: check.notes.join("; ") } : {}),
            }),
            language: source.originalLanguage,
            origin: "SOURCE_EXTRACTED",
            confidence: card.confidence.toFixed(2),
            reviewStatus: "EXTRACTED",
            reviewFlags: check.flags,
            safetySensitive: check.safetySensitive,
            safetyNotes: check.safetyNotes,
            extractionBatchId: batch.id,
            generationRunId: result?.runId ?? null,
            ordinalInBatch: ordinal,
          })
          .onConflictDoNothing({
            target: [schema.knowledgeItems.extractionBatchId, schema.knowledgeItems.ordinalInBatch],
          })
          .returning({ id: schema.knowledgeItems.id });
        if (row) inserted.push(row.id);
      }
      // The checks are done: new cards go to the chef's review queue (EXTRACTED → NEEDS_REVIEW).
      for (const id of inserted) {
        await transition(tx, {
          table: schema.knowledgeItems,
          statusKey: "reviewStatus",
          id,
          from: ["EXTRACTED"],
          to: "NEEDS_REVIEW",
          audit: { action: "knowledge.needs_review", entityType: "knowledge_item" },
        });
      }
      const [stored] = await tx.db
        .select({ n: count() })
        .from(schema.knowledgeItems)
        .where(eq(schema.knowledgeItems.extractionBatchId, batch.id));
      const total = stored?.n ?? 0;
      await transition(tx, {
        table: schema.knowledgeExtractionBatches,
        id: batch.id,
        from: ["RUNNING"],
        to: "SUCCEEDED",
        set: { cardsCreated: total, generationRunId: result?.runId ?? null, mode, error: null },
        audit: {
          entityType: "knowledge_extraction_batch",
          data: { cards: total, mode, fallbackUsed: mode !== batch.mode },
        },
      });
      return total;
    });
    return {
      batchId: batch.id,
      status: "SUCCEEDED",
      cardsCreated,
      mode,
      fallbackUsed: mode !== batch.mode,
      runIds,
    };
  } catch (error) {
    // Transient and unexpected errors: leave the batch retryable and let the job runner decide.
    await transition(ctx, {
      table: schema.knowledgeExtractionBatches,
      id: batch.id,
      from: ["RUNNING"],
      to: "FAILED",
      set: {
        error: {
          code: error instanceof Error && "code" in error ? String(error.code) : "ERROR",
          message: error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
        },
      },
      audit: { entityType: "knowledge_extraction_batch", data: { retryable: true } },
    }).catch((inner: unknown) => ctx.logger.error({ err: inner }, "could not mark batch FAILED"));
    throw error;
  }
}

/**
 * Inserts the planned batches of one attempt as PENDING rows. Existing rows of the same
 * `(source, attempt, index)` are kept, so planning twice is harmless.
 */
export async function insertBatches(
  ctx: ServiceContext,
  sourceAssetId: string,
  attempt: number,
  planned: readonly {
    batchIndex: number;
    pageStart: number;
    pageEnd: number;
    mode: "PDF_NATIVE" | "TEXT";
  }[],
): Promise<Batch[]> {
  if (planned.length > 0) {
    await ctx.db
      .insert(schema.knowledgeExtractionBatches)
      .values(planned.map((b) => ({ ...b, sourceAssetId, processingAttempt: attempt })))
      .onConflictDoNothing({
        target: [
          schema.knowledgeExtractionBatches.sourceAssetId,
          schema.knowledgeExtractionBatches.processingAttempt,
          schema.knowledgeExtractionBatches.batchIndex,
        ],
      });
  }
  return ctx.db
    .select()
    .from(schema.knowledgeExtractionBatches)
    .where(
      and(
        eq(schema.knowledgeExtractionBatches.sourceAssetId, sourceAssetId),
        eq(schema.knowledgeExtractionBatches.processingAttempt, attempt),
      ),
    )
    .orderBy(asc(schema.knowledgeExtractionBatches.batchIndex));
}
