import { readFile } from "node:fs/promises";
import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { extractText, getDocumentProxy } from "unpdf";
import { type ServiceContext, withTransaction } from "../../core";
import { SourceRejectedError } from "./sniff";

// PDF → pages (plan 07 §7.2.2). Pages without a text layer are kept: they still go to Claude as
// PDF pages (vision) in extraction batches, and P1 transcription can fill their text later.

/** A page "has a text layer" with at least this many characters and < 5 % replacement chars. */
export const MIN_TEXT_LAYER_CHARS = 200;
export const MAX_REPLACEMENT_RATIO = 0.05;

export type ExtractedPage = {
  /** 1-based. */
  pageNumber: number;
  text: string;
  charCount: number;
  hasTextLayer: boolean;
};

/** Text-layer heuristic on already-cleaned page text. */
export function hasTextLayer(text: string): boolean {
  if (text.length < MIN_TEXT_LAYER_CHARS) return false;
  const replacements = [...text].filter((c) => c === "�").length;
  return replacements / text.length < MAX_REPLACEMENT_RATIO;
}

/** NUL bytes are not allowed in Postgres text; trim edges, keep inner layout. */
function clean(text: string): string {
  return text.replaceAll("\u0000", "").trim();
}

/** Per-page text of a PDF file with the text-layer flag. Page count comes from the document. */
export async function extractPdfPages(path: string): Promise<ExtractedPage[]> {
  let pages: string[];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(await readFile(path)));
    pages = (await extractText(pdf, { mergePages: false })).text;
  } catch (error) {
    throw new SourceRejectedError("CORRUPT_PDF", "The PDF text could not be extracted.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  return pages.map((raw, index) => {
    const text = clean(raw);
    return {
      pageNumber: index + 1,
      text,
      charCount: text.length,
      hasTextLayer: hasTextLayer(text),
    };
  });
}

const INSERT_CHUNK = 200;

/**
 * Stores the pages of one processing attempt and `page_count`, replacing rows of any other
 * attempt, in one transaction. Re-running the same attempt replaces its own rows, so a retried
 * job is safe.
 */
export async function savePages(
  ctx: ServiceContext,
  sourceAssetId: string,
  attempt: number,
  pages: readonly ExtractedPage[],
): Promise<void> {
  await withTransaction(ctx, async (tx) => {
    await tx.db
      .delete(schema.sourcePages)
      .where(eq(schema.sourcePages.sourceAssetId, sourceAssetId));
    for (let i = 0; i < pages.length; i += INSERT_CHUNK) {
      await tx.db.insert(schema.sourcePages).values(
        pages.slice(i, i + INSERT_CHUNK).map((page) => ({
          sourceAssetId,
          pageNumber: page.pageNumber,
          text: page.text,
          charCount: page.charCount,
          hasTextLayer: page.hasTextLayer,
          processingAttempt: attempt,
        })),
      );
    }
    await tx.db
      .update(schema.sourceAssets)
      .set({ pageCount: pages.length })
      .where(eq(schema.sourceAssets.id, sourceAssetId));
  });
}
