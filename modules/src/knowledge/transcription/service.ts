import { schema } from "@rc/db";
import type { ValidationIssue } from "@rc/db/json";
import { and, asc, eq, inArray } from "@rc/db/orm";
import { NotFoundError, ValidationError } from "@rc/lib/errors";
import type { pageTranscriber } from "@rc/prompts";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { runStage } from "../../ai";
import { audit, type ServiceContext, withTransaction } from "../../core";
import { LOW_CONFIDENCE_THRESHOLD } from "../extraction/assess";
import { cutPdf } from "../extraction/plan";
import { verifyNumbers, verifyQuote } from "../extraction/verify-quote";
import { assertCanProcessWithAI } from "../rights";
import { fileExtension } from "../sources/limits";

// J19 `transcribe-pages` (plan 06, 07 §7.2.2, M1-24): pages of a PDF without a text layer (scans)
// are read by the model, so that quote and number checks can run against their text. After the
// text is saved, cards of the source whose quote could not be found are checked again.

type Output = pageTranscriber.TranscriberOutput;

/** Pages per model call; the prompt allows five. */
const PAGES_PER_CALL = 5;

export const TranscribePagesInput = z.object({
  sourceAssetId: z.uuid(),
  /** Only these pages (a retry or a manual request); default: every page without text. */
  pages: z.array(z.number().int().positive()).max(500).optional(),
});

export type TranscribeResult = {
  /** Pages whose text was saved. */
  transcribed: number;
  /** Pages the model could read only in part (their text is saved as far as it goes). */
  illegible: number[];
  /** Pages of a call whose answer could not be used; a later run tries them again. */
  failed: number[];
  /** Cards whose quote was found in the new text. */
  quotesVerified: number;
};

/** Consecutive page numbers, in groups of at most `size`. */
export function groupPages(pages: readonly number[], size = PAGES_PER_CALL): [number, number][] {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const groups: [number, number][] = [];
  for (const page of sorted) {
    const last = groups.at(-1);
    if (last && page === last[1] + 1 && page - last[0] + 1 <= size) last[1] = page;
    else groups.push([page, page]);
  }
  return groups;
}

/** The model must return each page of the range exactly once. */
export function validateTranscription(
  output: Output,
  range: { pageStart: number; pageEnd: number },
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const counts = new Map<number, number>();
  for (const p of output.pages) counts.set(p.page, (counts.get(p.page) ?? 0) + 1);
  for (let page = range.pageStart; page <= range.pageEnd; page++) {
    const n = counts.get(page) ?? 0;
    if (n !== 1) {
      issues.push({
        code: n === 0 ? "PAGE_MISSING" : "PAGE_REPEATED",
        severity: "BLOCKER",
        fieldPath: "pages",
        message: n === 0 ? `Page ${page} has no entry.` : `Page ${page} has ${n} entries.`,
        fixHint: `Return one entry for each source page ${range.pageStart}–${range.pageEnd}.`,
      });
    }
  }
  for (const page of counts.keys()) {
    if (page < range.pageStart || page > range.pageEnd) {
      issues.push({
        code: "PAGE_OUT_OF_RANGE",
        severity: "BLOCKER",
        fieldPath: "pages",
        message: `Page ${page} is not in ${range.pageStart}–${range.pageEnd}.`,
        fixHint: "Use the source page numbers from the task.",
      });
    }
  }
  return issues;
}

/** NUL bytes are not allowed in Postgres text. */
const clean = (text: string) => text.replaceAll("\u0000", "").trim();

export async function transcribeSourcePages(
  ctx: ServiceContext,
  raw: z.input<typeof TranscribePagesInput>,
): Promise<TranscribeResult> {
  const parsed = TranscribePagesInput.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const { sourceAssetId, pages: wanted } = parsed.data;
  const result: TranscribeResult = { transcribed: 0, illegible: [], failed: [], quotesVerified: 0 };

  const [source] = await ctx.db
    .select()
    .from(schema.sourceAssets)
    .where(eq(schema.sourceAssets.id, sourceAssetId));
  if (!source) throw new NotFoundError("Source not found.", { details: { sourceAssetId } });
  if (source.archivedAt) return result;
  // The pages go to a vendor: the same gate as for extraction.
  assertCanProcessWithAI(source);
  if (!source.fileKey || fileExtension(source.originalFilename ?? "") !== "pdf") return result;

  const rows = await ctx.db
    .select({ pageNumber: schema.sourcePages.pageNumber })
    .from(schema.sourcePages)
    .where(
      and(
        eq(schema.sourcePages.sourceAssetId, sourceAssetId),
        eq(schema.sourcePages.processingAttempt, source.processingAttempt),
        eq(schema.sourcePages.hasTextLayer, false),
        eq(schema.sourcePages.transcribed, false),
        wanted ? inArray(schema.sourcePages.pageNumber, wanted) : undefined,
      ),
    )
    .orderBy(asc(schema.sourcePages.pageNumber));
  const todo = rows.map((r) => r.pageNumber);
  if (todo.length === 0) return result;

  const document = await PDFDocument.load(await ctx.storage.getBytes(source.fileKey), {
    updateMetadata: false,
  });
  const changed: number[] = [];
  for (const [pageStart, pageEnd] of groupPages(todo)) {
    const sub = await cutPdf(document, pageStart, pageEnd);
    const stage = await runStage<Output>(ctx, {
      stage: "PAGE_TRANSCRIPTION",
      input: {
        source: { title: source.title, language: source.originalLanguage },
        pageStart,
        pageEnd,
      },
      attachments: [
        {
          type: "pdf",
          base64: Buffer.from(sub).toString("base64"),
          title: `${source.title}, pages ${pageStart}–${pageEnd}`,
        },
      ],
      validate: (output) => validateTranscription(output, { pageStart, pageEnd }),
      inputRefs: { sourceAssetId, pageRange: [pageStart, pageEnd] },
      sourceAssetId,
    });
    if (!stage.data) {
      for (let p = pageStart; p <= pageEnd; p++) result.failed.push(p);
      continue;
    }
    await withTransaction(ctx, async (tx) => {
      for (const entry of stage.data?.pages ?? []) {
        const text = clean(entry.text);
        if (!entry.legible) result.illegible.push(entry.page);
        // A page with no text that the model could read is simply empty: it is done. A page it
        // could not read at all stays open for another try.
        if (!text && !entry.legible) continue;
        await tx.db
          .update(schema.sourcePages)
          .set({ text, charCount: text.length, transcribed: true })
          .where(
            and(
              eq(schema.sourcePages.sourceAssetId, sourceAssetId),
              eq(schema.sourcePages.pageNumber, entry.page),
              eq(schema.sourcePages.processingAttempt, source.processingAttempt),
            ),
          );
        if (text) changed.push(entry.page);
        result.transcribed++;
      }
    });
  }

  if (changed.length > 0) result.quotesVerified = await recheckCards(ctx, source, changed);
  await audit(ctx, {
    action: "source.pages_transcribed",
    entityType: "source_asset",
    entityId: sourceAssetId,
    data: {
      transcribed: result.transcribed,
      illegible: result.illegible,
      failed: result.failed,
      quotesVerified: result.quotesVerified,
    },
  });
  return result;
}

/**
 * Cards of this source that are still in review and whose quote was not found: the new page text
 * may contain it. A found quote clears `QUOTE_UNVERIFIED`; numbers found in the new text clear the
 * `LOW_CONFIDENCE` that missing numbers caused. Approved cards are left as the chef decided.
 */
async function recheckCards(
  ctx: ServiceContext,
  source: typeof schema.sourceAssets.$inferSelect,
  changedPages: readonly number[],
): Promise<number> {
  const cards = await ctx.db
    .select()
    .from(schema.knowledgeItems)
    .where(
      and(
        eq(schema.knowledgeItems.sourceAssetId, source.id),
        inArray(schema.knowledgeItems.reviewStatus, ["EXTRACTED", "NEEDS_REVIEW"]),
      ),
    );
  const pages = await ctx.db
    .select()
    .from(schema.sourcePages)
    .where(
      and(
        eq(schema.sourcePages.sourceAssetId, source.id),
        eq(schema.sourcePages.processingAttempt, source.processingAttempt),
      ),
    );
  const texts = pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text }));
  let verified = 0;
  for (const card of cards) {
    const ref = card.sourceReference;
    if (!ref?.pageStart) continue;
    const cited = { pageStart: ref.pageStart, pageEnd: ref.pageEnd ?? ref.pageStart };
    const touched = changedPages.some((p) => p >= cited.pageStart - 1 && p <= cited.pageEnd + 1);
    if (!touched) continue;

    const flags = new Set(card.reviewFlags);
    const notes: string[] = [];
    let nextRef = ref;
    if (!ref.quoteVerified) {
      const check = verifyQuote(ref.quote, texts, cited);
      if (check.verified) {
        flags.delete("QUOTE_UNVERIFIED");
        notes.push("quote found after page transcription");
        nextRef = { ...ref, quoteVerified: true, matchScore: check.score };
        verified++;
      }
    }
    const missing = verifyNumbers(
      { temperatures: card.temperaturesJson, timings: card.timingsJson },
      texts,
      cited,
    ).missing;
    const lowConfidence =
      (card.confidence !== null && Number(card.confidence) < LOW_CONFIDENCE_THRESHOLD) ||
      missing.length > 0;
    if (!lowConfidence) flags.delete("LOW_CONFIDENCE");
    if (nextRef === ref && flags.size === card.reviewFlags.length) continue;
    if (notes.length) {
      nextRef = { ...nextRef, note: [ref.note, ...notes].filter(Boolean).join("; ") };
    }
    await ctx.db
      .update(schema.knowledgeItems)
      .set({ sourceReference: nextRef, reviewFlags: [...flags] })
      .where(eq(schema.knowledgeItems.id, card.id));
  }
  return verified;
}
