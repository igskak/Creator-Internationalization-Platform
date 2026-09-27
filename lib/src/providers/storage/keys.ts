import { ValidationError } from "../../errors";

// Object key layout (plan 08 §8.8). Ids must be single path segments; file names are sanitized.

const SEGMENT = /^[A-Za-z0-9_-]+$/;

function segment(name: string, value: string): string {
  if (!SEGMENT.test(value)) {
    throw new ValidationError(`Invalid ${name} for a storage key.`, { details: { name } });
  }
  return value;
}

function clean(part: string): string {
  return part
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
}

/**
 * ASCII letters, digits, dot, dash and underscore only; keeps the extension; never empty; at most
 * 120 characters. Non-Latin names (e.g. Russian) become `file.<ext>`; the original name stays in
 * the database.
 */
export function safeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? clean(base.slice(dot + 1)).slice(0, 10) : "";
  const stem = clean(dot > 0 ? base.slice(0, dot) : base) || "file";
  const suffix = ext ? `.${ext}` : "";
  return stem.slice(-(120 - suffix.length)) + suffix;
}

export const storageKeys = {
  source: (sourceAssetId: string, fileName: string) =>
    `sources/${segment("sourceAssetId", sourceAssetId)}/${safeFileName(fileName)}`,
  asset: (
    variantId: string,
    slideId: string,
    slot: string,
    promptHash: string,
    kind: "webp" | "orig.png",
  ) =>
    `assets/${segment("variantId", variantId)}/${segment("slideId", slideId)}-${segment("slot", slot)}-${segment("promptHash", promptHash)}.${kind}`,
  library: (visualAssetId: string) => `library/${segment("visualAssetId", visualAssetId)}.webp`,
  render: (variantId: string, renderId: string, index: number) => {
    if (!Number.isInteger(index) || index < 0) {
      throw new ValidationError("Invalid slide index for a storage key.");
    }
    return `renders/${segment("variantId", variantId)}/${segment("renderId", renderId)}/${index}.jpg`;
  },
  import: (id: string, ext: "csv" | "json") => `imports/${segment("id", id)}.${ext}`,
  tmp: (name: string) => `tmp/${safeFileName(name)}`,
};
