import type { SourceType } from "@rc/db/json";
import { ValidationError } from "@rc/lib/errors";

// Accepted inputs and limits (plan 07 §7.2.1). Checked when the presigned URL is issued and again
// by `ingest-source` against the real bytes (magic bytes, page count).

const MB = 1024 * 1024;

type Format = { mimeTypes: readonly string[]; maxBytes: number };

const PDF: Format = { mimeTypes: ["application/pdf"], maxBytes: 200 * MB };
const DOCX: Format = {
  mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  maxBytes: 50 * MB,
};
const TXT: Format = { mimeTypes: ["text/plain"], maxBytes: 20 * MB };
const MD: Format = {
  mimeTypes: ["text/markdown", "text/x-markdown", "text/plain"],
  maxBytes: 20 * MB,
};
const SRT: Format = { mimeTypes: ["application/x-subrip", "text/plain"], maxBytes: 20 * MB };
const VTT: Format = { mimeTypes: ["text/vtt", "text/plain"], maxBytes: 20 * MB };

const photo = (mimeType: string): Format => ({ mimeTypes: [mimeType], maxBytes: 25 * MB });
const PHOTO_FORMATS: Record<string, Format> = {
  jpg: photo("image/jpeg"),
  jpeg: photo("image/jpeg"),
  png: photo("image/png"),
  webp: photo("image/webp"),
};

const DOCUMENT_FORMATS: Record<string, Format> = { pdf: PDF, docx: DOCX, txt: TXT, md: MD };

/** Extension (lower case, no dot) → format, per source type. Absent types are not accepted. */
export const ACCEPTED_FORMATS: Partial<Record<SourceType, Record<string, Format>>> = {
  BOOK: DOCUMENT_FORMATS,
  GUIDE: DOCUMENT_FORMATS,
  RECIPE: DOCUMENT_FORMATS,
  PRODUCT_MATERIAL: DOCUMENT_FORMATS,
  NOTE: { txt: TXT, md: MD },
  TRANSCRIPT: { srt: SRT, vtt: VTT, txt: TXT },
  /** Library photos (M3-16): imported by `import-library-photo`, not read by a model. */
  PHOTO: PHOTO_FORMATS,
};

/** Pasted-text limit for NOTE / TRANSCRIPT / RECIPE (characters). */
export const MAX_TEXT_CHARS = 200_000;

const NOT_ACCEPTED: Partial<Record<SourceType, string>> = {
  VIDEO: "Video transcription arrives with Reels (post-MVP). Upload a transcript instead.",
  INSTAGRAM_POST: "Instagram posts are imported with the historical posts import, not as sources.",
};

/** Largest accepted size for a type and file name, or undefined if the file is not accepted. */
export function maxBytesFor(type: SourceType, fileName: string): number | undefined {
  return ACCEPTED_FORMATS[type]?.[fileExtension(fileName)]?.maxBytes;
}

/** Lower-case extension without the dot, or "". */
export function fileExtension(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** The size limit for a type and file name; throws ValidationError if the file is not accepted. */
export function checkUploadAllowed(
  type: SourceType,
  fileName: string,
  mimeType: string,
  sizeBytes: number,
): { maxBytes: number } {
  const reject = (field: string, message: string): never => {
    throw new ValidationError(message, { fieldErrors: { [field]: [message] } });
  };
  const hint = NOT_ACCEPTED[type];
  if (hint) reject("type", hint);

  const formats = ACCEPTED_FORMATS[type] ?? {};
  const ext = fileExtension(fileName);
  const format = formats[ext];
  if (!format) {
    return reject(
      "fileName",
      `File type ".${ext}" is not accepted for ${type}. Allowed: ${Object.keys(formats)
        .map((e) => `.${e}`)
        .join(", ")}.`,
    );
  }
  const mime = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (!format.mimeTypes.includes(mime)) {
    reject("mimeType", `Content type "${mimeType}" does not match .${ext}.`);
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    reject("sizeBytes", "The file is empty.");
  }
  if (sizeBytes > format.maxBytes) {
    reject("sizeBytes", `The file is larger than ${Math.round(format.maxBytes / MB)} MB.`);
  }
  return { maxBytes: format.maxBytes };
}
