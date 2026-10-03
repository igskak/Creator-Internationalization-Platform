import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { schema } from "@rc/db";
import type { SourceType } from "@rc/db/json";
import { and, eq, isNull, ne } from "@rc/db/orm";
import { AppError, NotFoundError } from "@rc/lib/errors";
import { fileTypeFromFile } from "file-type";
import { PDFDocument } from "pdf-lib";
import type { ServiceContext } from "../../core";
import { fileExtension, maxBytesFor } from "../sources/limits";

// Job-side validation of an uploaded source (plan 06 J1 steps 3–4, 07 §7.2.1): the real bytes are
// hashed and sniffed, never trusted by name or declared type. Parsing into pages is M1-06/07.

export const MAX_PDF_PAGES = 1000;

export const SOURCE_REJECTION_CODES = [
  "FILE_MISSING",
  "UNSUPPORTED_TYPE",
  "TOO_LARGE",
  "TYPE_MISMATCH",
  "ENCRYPTED_PDF",
  "CORRUPT_PDF",
  "TOO_MANY_PAGES",
  "EMPTY_FILE",
  "NOT_TEXT",
  "DUPLICATE_SOURCE",
] as const;
export type SourceRejectionCode = (typeof SOURCE_REJECTION_CODES)[number];

/**
 * The file cannot be processed and retrying will not help. `reason` goes to
 * `source_assets.processing_error.code`; the message is safe to show to the user.
 */
export class SourceRejectedError extends AppError {
  readonly reason: SourceRejectionCode;
  constructor(reason: SourceRejectionCode, message: string, details: Record<string, unknown> = {}) {
    super("VALIDATION", message, { details: { reason, ...details } });
    this.name = "SourceRejectedError";
    this.reason = reason;
  }
}

export type FileKind = "pdf" | "docx" | "text";
export type TextEncoding = "utf-8" | "windows-1251";

export type SniffResult = {
  kind: FileKind;
  sizeBytes: number;
  checksumSha256: string;
  /** Local temp copy; remove with `cleanup()` when done. */
  path: string;
  cleanup: () => Promise<void>;
  /** PDFs only. */
  pageCount?: number;
  /** Text files only. */
  encoding?: TextEncoding;
};

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const KIND_BY_EXTENSION: Record<string, FileKind> = {
  pdf: "pdf",
  docx: "docx",
  txt: "text",
  md: "text",
  srt: "text",
  vtt: "text",
};

/**
 * Streams the object to a temp file while hashing it and enforcing the size limit; then checks
 * the real type against the file name, and for PDFs the page limit and encryption, for text that
 * it decodes as UTF-8 or Windows-1251. Throws SourceRejectedError; the temp file is removed on
 * every failure.
 */
export async function sniffSource(
  ctx: ServiceContext,
  file: { fileKey: string; fileName: string; type: SourceType },
): Promise<SniffResult> {
  const maxBytes = maxBytesFor(file.type, file.fileName);
  const expected = KIND_BY_EXTENSION[fileExtension(file.fileName)];
  if (maxBytes === undefined || !expected) {
    throw new SourceRejectedError(
      "UNSUPPORTED_TYPE",
      `Files named "${file.fileName}" are not accepted for ${file.type}.`,
    );
  }

  const dir = await mkdtemp(join(tmpdir(), "rc-source-"));
  const path = join(dir, "source");
  const cleanup = () => rm(dir, { recursive: true, force: true });
  try {
    const { checksumSha256, sizeBytes } = await download(ctx, file.fileKey, path, maxBytes);
    if (sizeBytes === 0) throw new SourceRejectedError("EMPTY_FILE", "The file is empty.");

    const result: SniffResult = { kind: expected, sizeBytes, checksumSha256, path, cleanup };
    const detected = await fileTypeFromFile(path);
    if (expected === "pdf") {
      if (detected?.mime !== "application/pdf") throw typeMismatch(expected, detected?.mime);
      result.pageCount = await checkPdf(path);
    } else if (expected === "docx") {
      if (detected?.mime !== DOCX_MIME) throw typeMismatch(expected, detected?.mime);
    } else {
      if (detected) throw typeMismatch(expected, detected.mime);
      result.encoding = detectTextEncoding(await readFile(path));
    }
    return result;
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/** Another active source of the brand with the same checksum → DUPLICATE_SOURCE (06 J1 step 3). */
export async function assertNotDuplicate(
  ctx: ServiceContext,
  source: { id: string; brandId: string },
  checksumSha256: string,
): Promise<void> {
  const [duplicate] = await ctx.db
    .select({ id: schema.sourceAssets.id, title: schema.sourceAssets.title })
    .from(schema.sourceAssets)
    .where(
      and(
        eq(schema.sourceAssets.brandId, source.brandId),
        eq(schema.sourceAssets.checksumSha256, checksumSha256),
        isNull(schema.sourceAssets.archivedAt),
        ne(schema.sourceAssets.id, source.id),
      ),
    )
    .limit(1);
  if (duplicate) {
    throw new SourceRejectedError(
      "DUPLICATE_SOURCE",
      `This file is already in the library as "${duplicate.title}".`,
      { duplicateOfId: duplicate.id },
    );
  }
}

async function download(
  ctx: ServiceContext,
  fileKey: string,
  path: string,
  maxBytes: number,
): Promise<{ checksumSha256: string; sizeBytes: number }> {
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = await ctx.storage.getStream(fileKey);
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw new SourceRejectedError("FILE_MISSING", "The uploaded file is no longer in storage.");
    }
    throw error;
  }
  const hash = createHash("sha256");
  let sizeBytes = 0;
  const measure = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sizeBytes += chunk.length;
      if (sizeBytes > maxBytes) {
        callback(
          new SourceRejectedError(
            "TOO_LARGE",
            `The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`,
          ),
        );
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(stream as never), measure, createWriteStream(path));
  return { checksumSha256: hash.digest("hex"), sizeBytes: (await stat(path)).size };
}

function typeMismatch(expected: FileKind, actualMime: string | undefined): SourceRejectedError {
  return new SourceRejectedError(
    "TYPE_MISMATCH",
    `The file content does not look like a ${expected.toUpperCase()} file.`,
    { expected, detected: actualMime ?? "unknown" },
  );
}

async function checkPdf(path: string): Promise<number> {
  const bytes = await readFile(path);
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    // pdf-lib's EncryptedPDFError loses its class name when bundled, so match the message.
    if (error instanceof Error && /is encrypted/i.test(error.message)) {
      throw new SourceRejectedError(
        "ENCRYPTED_PDF",
        "The PDF is password-protected. Remove the protection and upload it again.",
      );
    }
    throw new SourceRejectedError("CORRUPT_PDF", "The PDF could not be read.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const pageCount = document.getPageCount();
  if (pageCount > MAX_PDF_PAGES) {
    throw new SourceRejectedError(
      "TOO_MANY_PAGES",
      `The PDF has ${pageCount} pages; the limit is ${MAX_PDF_PAGES}. Split it and upload the parts.`,
      { pageCount },
    );
  }
  return pageCount;
}

const CYRILLIC = /[Ѐ-ӿ]/u;

/**
 * UTF-8 if the bytes are valid UTF-8; otherwise Windows-1251 when the high bytes decode mostly
 * to Cyrillic. Anything with NUL bytes or many control characters is not text.
 */
export function detectTextEncoding(bytes: Uint8Array): TextEncoding {
  const notText = () =>
    new SourceRejectedError("NOT_TEXT", "The file is not readable text (UTF-8 or Windows-1251).");
  const controls = bytes.reduce(
    (n, b) => n + (b === 0 || (b < 0x20 && b !== 9 && b !== 10 && b !== 13) ? 1 : 0),
    0,
  );
  if (bytes.includes(0) || controls > bytes.length * 0.01) throw notText();
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return "utf-8";
  } catch {
    // fall through to the legacy Cyrillic encoding
  }
  const high = bytes.filter((b) => b >= 0x80);
  const text = new TextDecoder("windows-1251").decode(high);
  const cyrillic = [...text].filter((c) => CYRILLIC.test(c)).length;
  if (high.length > 0 && cyrillic / high.length >= 0.7) return "windows-1251";
  throw notText();
}
