import { PDFDocument } from "pdf-lib";

// Extraction batch planning (plan 07 §7.2.3). Pure: the caller loads page data and inserts rows.

export const PDF_PAGES_PER_BATCH = 15;
/** Request limit is 32 MB (V-18); stay below it with room for the prompt. */
export const MAX_SUB_PDF_BYTES = 25 * 1024 * 1024;
export const TEXT_BATCH_TOKENS = 12_000;

export type PlannedBatch = {
  batchIndex: number;
  pageStart: number;
  pageEnd: number;
  mode: "PDF_NATIVE" | "TEXT";
};

export type PlanPage = { pageNumber: number; charCount: number };

/** Characters per token: Cyrillic text needs more tokens than Latin (07 §7.2.3). */
const CYRILLIC_LANGUAGES = new Set(["ru", "uk", "bg", "be", "sr", "mk"]);
export const charsPerToken = (language: string) => (CYRILLIC_LANGUAGES.has(language) ? 3 : 4);

/**
 * TEXT batches: pages in order, packed until the estimated size would pass ~12k tokens. A page
 * larger than that goes alone. Page numbers need not be contiguous only if pages are missing, so
 * a batch always spans first..last page of its group.
 */
export function planTextBatches(
  pages: readonly PlanPage[],
  language: string,
  maxTokens: number = TEXT_BATCH_TOKENS,
): PlannedBatch[] {
  const budget = maxTokens * charsPerToken(language);
  const batches: PlannedBatch[] = [];
  let start: number | undefined;
  let end = 0;
  let size = 0;
  const flush = () => {
    if (start === undefined) return;
    batches.push({ batchIndex: batches.length, pageStart: start, pageEnd: end, mode: "TEXT" });
    start = undefined;
    size = 0;
  };
  for (const page of [...pages].sort((a, b) => a.pageNumber - b.pageNumber)) {
    if (start !== undefined && size + page.charCount > budget) flush();
    start ??= page.pageNumber;
    end = page.pageNumber;
    size += page.charCount;
  }
  flush();
  return batches;
}

/**
 * PDF_NATIVE batches of 15 pages. A sub-PDF must stay under 25 MB: when the whole file is under
 * the guard no sub-PDF can pass it, otherwise each range is measured with `measure` and halved
 * until it fits. A single page that is still too large becomes a TEXT batch (the batch step falls
 * back to the page text, or fails).
 */
export async function planPdfBatches(
  pageCount: number,
  fileSizeBytes: number,
  measure: (pageStart: number, pageEnd: number) => Promise<number>,
  options: { pagesPerBatch?: number; maxBytes?: number } = {},
): Promise<PlannedBatch[]> {
  const per = options.pagesPerBatch ?? PDF_PAGES_PER_BATCH;
  const maxBytes = options.maxBytes ?? MAX_SUB_PDF_BYTES;
  const ranges: PlannedBatch[] = [];

  const fit = async (start: number, end: number): Promise<void> => {
    if (fileSizeBytes <= maxBytes || (await measure(start, end)) <= maxBytes) {
      ranges.push({ batchIndex: 0, pageStart: start, pageEnd: end, mode: "PDF_NATIVE" });
    } else if (start === end) {
      ranges.push({ batchIndex: 0, pageStart: start, pageEnd: end, mode: "TEXT" });
    } else {
      const mid = Math.floor((start + end) / 2);
      await fit(start, mid);
      await fit(mid + 1, end);
    }
  };
  for (let start = 1; start <= pageCount; start += per) {
    await fit(start, Math.min(start + per - 1, pageCount));
  }
  return ranges.map((range, batchIndex) => ({ ...range, batchIndex }));
}

/** The pages `pageStart..pageEnd` (1-based, inclusive) as a new PDF. */
export async function cutPdf(
  source: Uint8Array | PDFDocument,
  pageStart: number,
  pageEnd: number,
): Promise<Uint8Array> {
  const document =
    source instanceof PDFDocument
      ? source
      : await PDFDocument.load(source, { updateMetadata: false });
  const out = await PDFDocument.create();
  const indices = Array.from({ length: pageEnd - pageStart + 1 }, (_, i) => pageStart - 1 + i);
  for (const page of await out.copyPages(document, indices)) out.addPage(page);
  return out.save();
}

/** Measures sub-PDF sizes of one document for `planPdfBatches` (loads the document once). */
export async function pdfMeasurer(bytes: Uint8Array) {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  return async (pageStart: number, pageEnd: number) =>
    (await cutPdf(document, pageStart, pageEnd)).byteLength;
}
