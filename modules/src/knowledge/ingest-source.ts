import { readFile } from "node:fs/promises";
import { schema } from "@rc/db";
import type { ProcessingProgress } from "@rc/db/json";
import { and, count, eq, inArray } from "@rc/db/orm";
import { InvalidStateError, NotFoundError, RightsBlockedError } from "@rc/lib/errors";
import { type ServiceContext, transition } from "../core";
import { requestEmbedding } from "./embedding";
import { insertBatches, pdfMeasurer, planPdfBatches, planTextBatches } from "./extraction";
import {
  assertNotDuplicate,
  type ExtractedPage,
  extractPdfPages,
  parseDocx,
  parseTextFile,
  parseTranscriptFile,
  type SniffResult,
  SourceRejectedError,
  savePages,
  sniffSource,
} from "./ingestion";
import { canProcessWithAI } from "./rights";
import { fileExtension } from "./sources/limits";

// J1 `ingest-source` (plan 06 §6.3): rights gate → sniff → pages → batches → extraction → READY.
// Quote verification and the review queue happen inside each batch (M1-13/M1-14); embeddings and
// dedupe suggestions are M1-16.

type Source = typeof schema.sourceAssets.$inferSelect;
export type IngestMode = "FULL" | "KNOWLEDGE_ONLY";

export type IngestOutcome =
  | { status: "SKIPPED"; reason: "STALE_ATTEMPT" | "ALREADY_DONE" | "ARCHIVED" }
  | { status: "READY"; cardsCreated: number; batches: number; failedBatches: number }
  | { status: "FAILED"; code: string };

/** Parses the sniffed file into pages by its real kind and extension. */
async function parsePages(source: Source, sniff: SniffResult): Promise<ExtractedPage[]> {
  const ext = fileExtension(source.originalFilename ?? "");
  if (sniff.kind === "pdf") return extractPdfPages(sniff.path);
  if (sniff.kind === "docx") return parseDocx(sniff.path);
  const encoding = sniff.encoding ? { encoding: sniff.encoding } : {};
  if (ext === "srt" || ext === "vtt") return parseTranscriptFile(sniff.path, encoding);
  return parseTextFile(sniff.path, { markdown: ext === "md", ...encoding });
}

export async function ingestSource(
  ctx: ServiceContext,
  input: { sourceAssetId: string; attempt: number; mode?: IngestMode },
): Promise<IngestOutcome> {
  const [source] = await ctx.db
    .select()
    .from(schema.sourceAssets)
    .where(eq(schema.sourceAssets.id, input.sourceAssetId));
  if (!source) throw new NotFoundError("Source not found.", { details: input });
  if (source.archivedAt) return { status: "SKIPPED", reason: "ARCHIVED" };
  if (source.processingAttempt !== input.attempt) {
    return { status: "SKIPPED", reason: "STALE_ATTEMPT" };
  }
  if (source.processingStatus === "READY" || source.processingStatus === "FAILED") {
    return { status: "SKIPPED", reason: "ALREADY_DONE" };
  }
  // A retried run finds the source PROCESSING and resumes.
  if (source.processingStatus !== "QUEUED" && source.processingStatus !== "PROCESSING") {
    throw new InvalidStateError(`Cannot process a source in status ${source.processingStatus}.`);
  }

  const id = source.id;
  const attempt = source.processingAttempt;
  const entityType = "source_asset";
  const move = (
    to: "PROCESSING" | "READY" | "FAILED" | "BLOCKED",
    set: object,
    action: string,
    data = {},
  ) =>
    transition(ctx, {
      table: schema.sourceAssets,
      statusKey: "processingStatus",
      id,
      from: ["QUEUED", "PROCESSING"],
      to,
      set,
      audit: { action, entityType, data },
    });
  const progressOf = (patch: ProcessingProgress): ProcessingProgress => patch;
  const setProgress = async (progress: ProcessingProgress) => {
    await ctx.db
      .update(schema.sourceAssets)
      .set({ processingProgress: progress })
      .where(eq(schema.sourceAssets.id, id));
  };

  // Rights gate: the model never sees a source without `aiProcessing = ALLOWED`.
  if (!canProcessWithAI(source)) {
    await move("BLOCKED", {}, "source.blocked", { reason: "RIGHTS" });
    throw new RightsBlockedError("AI processing is not allowed for this source.", {
      details: { sourceAssetId: id },
    });
  }
  await move(
    "PROCESSING",
    { processingError: null, processingProgress: { stage: "SNIFF" } },
    "source.processing_started",
    {
      attempt,
      mode: input.mode ?? "FULL",
    },
  );

  try {
    // --- pages ------------------------------------------------------------------------------
    let mode: IngestMode = input.mode ?? "FULL";
    if (mode === "KNOWLEDGE_ONLY") {
      const [existing] = await ctx.db
        .select({ n: count() })
        .from(schema.sourcePages)
        .where(eq(schema.sourcePages.sourceAssetId, id));
      if (!existing?.n) mode = "FULL"; // nothing to reuse
    }
    if (mode === "KNOWLEDGE_ONLY") {
      // Same pages, new attempt: re-run extraction only.
      await ctx.db
        .update(schema.sourcePages)
        .set({ processingAttempt: attempt })
        .where(eq(schema.sourcePages.sourceAssetId, id));
    } else {
      if (!source.fileKey) throw new SourceRejectedError("FILE_MISSING", "The source has no file.");
      const sniff = await sniffSource(ctx, {
        fileKey: source.fileKey,
        fileName: source.originalFilename ?? "",
        type: source.type,
      });
      try {
        await assertNotDuplicate(ctx, source, sniff.checksumSha256);
        await ctx.db
          .update(schema.sourceAssets)
          .set({ checksumSha256: sniff.checksumSha256, fileSizeBytes: sniff.sizeBytes })
          .where(eq(schema.sourceAssets.id, id));
        await setProgress({ stage: "PARSE" });
        const parsed = await parsePages(source, sniff);
        if (parsed.length === 0 || parsed.every((p) => p.charCount === 0 && p.hasTextLayer)) {
          throw new SourceRejectedError("EMPTY_FILE", "No text could be read from the file.");
        }
        await savePages(ctx, id, attempt, parsed);
      } finally {
        await sniff.cleanup();
      }
    }

    // --- batches ----------------------------------------------------------------------------
    await setProgress({ stage: "PLAN" });
    const pages = await ctx.db
      .select({
        pageNumber: schema.sourcePages.pageNumber,
        charCount: schema.sourcePages.charCount,
      })
      .from(schema.sourcePages)
      .where(
        and(
          eq(schema.sourcePages.sourceAssetId, id),
          eq(schema.sourcePages.processingAttempt, attempt),
        ),
      );
    const isPdf = fileExtension(source.originalFilename ?? "") === "pdf";
    let measurer: ((start: number, end: number) => Promise<number>) | undefined;
    const planned = isPdf
      ? await planPdfBatches(pages.length, source.fileSizeBytes ?? 0, async (start, end) => {
          // Only reached for files over the sub-PDF size guard.
          measurer ??= await pdfMeasurer(await readIfPdf(ctx, source));
          return measurer(start, end);
        })
      : planTextBatches(pages, source.originalLanguage);
    const batches = await insertBatches(ctx, id, attempt, planned);
    await setProgress({
      stage: "EXTRACT",
      pagesTotal: pages.length,
      batchesTotal: batches.length,
      batchesDone: batches.filter((b) => b.status === "SUCCEEDED").length,
    });

    // --- extraction (waits for every batch; a failed batch does not stop the others) ---------
    const todo = batches.filter((b) => b.status !== "SUCCEEDED" && b.status !== "SKIPPED");
    if (todo.length > 0) {
      await ctx.jobs.triggerAndWaitAll(
        "extract-knowledge-batch",
        todo.map((b) => ({ batchId: b.id })),
        ctx.requestId ? { requestId: ctx.requestId } : {},
      );
    }

    // --- finalize ---------------------------------------------------------------------------
    const finished = await insertBatches(ctx, id, attempt, []);
    const succeeded = finished.filter((b) => b.status === "SUCCEEDED");
    const failed = finished.filter((b) => b.status !== "SUCCEEDED" && b.status !== "SKIPPED");
    const cardsCreated = succeeded.reduce((sum, b) => sum + b.cardsCreated, 0);
    const failedBatches = failed.map((b) => ({
      batchIndex: b.batchIndex,
      pageStart: b.pageStart,
      pageEnd: b.pageEnd,
      code: b.error?.code ?? b.status,
    }));
    const progress = progressOf({
      stage: "DONE",
      pagesTotal: pages.length,
      batchesTotal: finished.length,
      batchesDone: succeeded.length,
      cardsCreated,
      ...(failedBatches.length ? { failedBatches } : {}),
    });
    if (succeeded.length > 0) {
      await move(
        "READY",
        { processingProgress: progress, processingError: null },
        "source.processed",
        {
          attempt,
          cards: cardsCreated,
          batches: finished.length,
          failedBatches: failedBatches.length,
        },
      );
      await requestCardEmbeddings(
        ctx,
        succeeded.map((b) => b.id),
      );
      return {
        status: "READY",
        cardsCreated,
        batches: finished.length,
        failedBatches: failedBatches.length,
      };
    }
    await move(
      "FAILED",
      {
        processingProgress: progress,
        processingError: {
          code: "ALL_BATCHES_FAILED",
          message: "No part of the source could be extracted. Reprocess it or check the file.",
          details: { failedBatches },
        },
      },
      "source.failed",
      { attempt, code: "ALL_BATCHES_FAILED" },
    );
    return { status: "FAILED", code: "ALL_BATCHES_FAILED" };
  } catch (error) {
    if (error instanceof SourceRejectedError) {
      await move(
        "FAILED",
        {
          processingError: {
            code: error.reason,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          },
        },
        "source.failed",
        { attempt, code: error.reason },
      );
      return { status: "FAILED", code: error.reason };
    }
    // Transient and unexpected errors: stay PROCESSING; the job runner retries and resumes.
    throw error;
  }
}

/**
 * After READY: vectors and duplicate suggestions for the new cards run as their own job (J3). If
 * that cannot even be started, the source stays READY and the backfill job picks the cards up.
 */
async function requestCardEmbeddings(ctx: ServiceContext, batchIds: string[]): Promise<void> {
  try {
    const cards = await ctx.db
      .select({ id: schema.knowledgeItems.id })
      .from(schema.knowledgeItems)
      .where(inArray(schema.knowledgeItems.extractionBatchId, batchIds));
    for (let i = 0; i < cards.length; i += 500) {
      await requestEmbedding(
        ctx,
        cards.slice(i, i + 500).map((c) => c.id),
      );
    }
  } catch (error) {
    ctx.logger.warn({ err: error }, "could not embed the new cards now; the backfill job will");
  }
}

async function readIfPdf(ctx: ServiceContext, source: Source): Promise<Uint8Array> {
  if (!source.fileKey) throw new SourceRejectedError("FILE_MISSING", "The source has no file.");
  return ctx.storage.getBytes(source.fileKey);
}
