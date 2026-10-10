import { randomUUID } from "node:crypto";
import { schema } from "@rc/db";
import type { RightsPolicy } from "@rc/db/json";
import { and, desc, eq } from "@rc/db/orm";
import { InvalidStateError, NotFoundError, PermanentError } from "@rc/lib/errors";
import { storageKeys } from "@rc/lib/providers/storage";
import sharp from "sharp";
import { z } from "zod";
import { audit, type ServiceContext, transition } from "../../core";
import { perceptualHash } from "../images";

// The photo library (plan 08 §8.4, M3-16): Reg.Chef's own photos, uploaded as PHOTO sources, become
// `visual_assets` (LIBRARY_PHOTO) with a description and tags. The visual director may choose one
// for an image slot, but only when the rights allow a visual transform (spec §6.2): the slide
// crops it, puts text over it and may darken it. AI tagging is optional and not done here.

/** The long side of a stored library photo, in pixels. */
export const LIBRARY_MAX_SIDE = 2160;
export const MAX_TAGS = 12;

type Source = typeof schema.sourceAssets.$inferSelect;

/** Visual transformation needs an explicit ALLOWED; a RESTRICTED source is out even then. */
export const canTransformVisually = (source: {
  rights: RightsPolicy;
  rightsStatus: Source["rightsStatus"];
}): boolean =>
  source.rights.visuallyTransform === "ALLOWED" && source.rightsStatus !== "RESTRICTED";

export type ImportPhotoOutcome =
  | { status: "SKIPPED"; reason: "STALE_ATTEMPT" | "ALREADY_DONE" | "ARCHIVED" }
  | { status: "READY"; assetId: string; width: number; height: number }
  | { status: "FAILED"; code: string };

/**
 * J20 `import-library-photo`: reads the uploaded photo, makes the stored WebP (auto-oriented, sRGB,
 * at most 2160 px on the long side), its perceptual hash, and the `visual_assets` row. The source
 * becomes READY. A file that is not an image ends the source as FAILED and returns normally.
 */
export async function importLibraryPhoto(
  ctx: ServiceContext,
  input: { sourceAssetId: string; attempt: number },
): Promise<ImportPhotoOutcome> {
  const [source] = await ctx.db
    .select()
    .from(schema.sourceAssets)
    .where(eq(schema.sourceAssets.id, input.sourceAssetId));
  if (!source) throw new NotFoundError("Source not found.", { details: input });
  if (source.type !== "PHOTO") {
    throw new InvalidStateError("Only PHOTO sources go to the library.", {
      details: { sourceAssetId: source.id, type: source.type },
    });
  }
  if (source.archivedAt) return { status: "SKIPPED", reason: "ARCHIVED" };
  if (source.processingAttempt !== input.attempt) {
    return { status: "SKIPPED", reason: "STALE_ATTEMPT" };
  }
  if (source.processingStatus === "READY" || source.processingStatus === "FAILED") {
    return { status: "SKIPPED", reason: "ALREADY_DONE" };
  }
  if (!source.fileKey) throw new InvalidStateError("The source has no file.");

  await transition(ctx, {
    table: schema.sourceAssets,
    statusKey: "processingStatus",
    id: source.id,
    from: ["QUEUED", "PROCESSING"],
    to: "PROCESSING",
    audit: { action: "source.processing", entityType: "source_asset", data: { type: "PHOTO" } },
  });

  const fail = async (code: string, message: string): Promise<ImportPhotoOutcome> => {
    await transition(ctx, {
      table: schema.sourceAssets,
      statusKey: "processingStatus",
      id: source.id,
      from: ["PROCESSING"],
      to: "FAILED",
      set: { processingError: { code, message } },
      audit: { action: "source.failed", entityType: "source_asset", data: { code } },
    });
    return { status: "FAILED", code };
  };

  const original = await ctx.storage.getBytes(source.fileKey);
  let stored: { data: Buffer; width: number; height: number };
  try {
    const { data, info } = await sharp(original, { failOn: "error" })
      .rotate()
      .toColourspace("srgb")
      .resize(LIBRARY_MAX_SIDE, LIBRARY_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 90 })
      .toBuffer({ resolveWithObject: true });
    stored = { data, width: info.width, height: info.height };
  } catch {
    return fail("NOT_AN_IMAGE", "The file could not be read as an image.");
  }

  // A second run (retry after a crash) finds the asset of this source instead of making another.
  const [existing] = await ctx.db
    .select({ id: schema.visualAssets.id })
    .from(schema.visualAssets)
    .where(
      and(
        eq(schema.visualAssets.sourceAssetId, source.id),
        eq(schema.visualAssets.kind, "LIBRARY_PHOTO"),
      ),
    );
  const assetId = existing?.id ?? randomUUID();
  const storageKey = storageKeys.library(assetId);
  await ctx.storage.put(storageKey, new Uint8Array(stored.data), { contentType: "image/webp" });
  if (!existing) {
    const meta = (source.metadataJson ?? {}) as { description?: unknown; tags?: unknown };
    await ctx.db.insert(schema.visualAssets).values({
      id: assetId,
      brandId: source.brandId,
      kind: "LIBRARY_PHOTO",
      status: "READY",
      sourceAssetId: source.id,
      storageKey,
      originalKey: source.fileKey,
      mimeType: "image/webp",
      width: stored.width,
      height: stored.height,
      bytes: stored.data.byteLength,
      phash: await perceptualHash(new Uint8Array(stored.data)),
      isAiGenerated: false,
      description: typeof meta.description === "string" ? meta.description : source.title,
      tags: Array.isArray(meta.tags) ? normalizeTags(meta.tags.map(String)) : [],
      rights: source.rights,
    });
  }
  await transition(ctx, {
    table: schema.sourceAssets,
    statusKey: "processingStatus",
    id: source.id,
    from: ["PROCESSING"],
    to: "READY",
    audit: {
      action: "source.ready",
      entityType: "source_asset",
      data: { type: "PHOTO", assetId },
    },
  });
  return { status: "READY", assetId, width: stored.width, height: stored.height };
}

/** Lower case, trimmed, no empties or repeats, at most 12. */
export function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, MAX_TAGS);
}

export const UpdateLibraryPhotoInput = z.object({
  assetId: z.uuid(),
  description: z.string().trim().max(500).optional(),
  tags: z.array(z.string().max(40)).max(40).optional(),
  /** REJECTED takes the photo out of the director's choice; READY brings it back. */
  status: z.enum(["READY", "REJECTED"]).optional(),
});

/** Manual description, tags and availability of a library photo. */
export async function updateLibraryPhoto(
  ctx: ServiceContext,
  raw: z.input<typeof UpdateLibraryPhotoInput>,
): Promise<void> {
  const input = UpdateLibraryPhotoInput.parse(raw);
  const [asset] = await ctx.db
    .select()
    .from(schema.visualAssets)
    .where(eq(schema.visualAssets.id, input.assetId));
  if (!asset || asset.kind !== "LIBRARY_PHOTO") {
    throw new NotFoundError("Library photo not found.", { details: { assetId: input.assetId } });
  }
  await ctx.db
    .update(schema.visualAssets)
    .set({
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.tags ? { tags: normalizeTags(input.tags) } : {}),
      ...(input.status ? { status: input.status } : {}),
    })
    .where(eq(schema.visualAssets.id, input.assetId));
  await audit(ctx, {
    action: "library_photo.updated",
    entityType: "visual_asset",
    entityId: input.assetId,
    data: { fields: Object.keys(input).filter((k) => k !== "assetId") },
  });
}

export type LibraryCandidate = { id: string; description: string; tags: string[] };

/**
 * The photos the visual director may choose: READY library photos whose source is not archived and
 * whose rights (read from the source, so a later change counts) allow a visual transform. Newest
 * first, at most `limit`.
 */
export async function listLibraryCandidates(
  ctx: ServiceContext,
  limit = 60,
): Promise<LibraryCandidate[]> {
  const rows = await ctx.db
    .select({ asset: schema.visualAssets, source: schema.sourceAssets })
    .from(schema.visualAssets)
    .innerJoin(schema.sourceAssets, eq(schema.sourceAssets.id, schema.visualAssets.sourceAssetId))
    .where(
      and(eq(schema.visualAssets.kind, "LIBRARY_PHOTO"), eq(schema.visualAssets.status, "READY")),
    )
    .orderBy(desc(schema.visualAssets.createdAt));
  return rows
    .filter(({ source }) => !source.archivedAt && canTransformVisually(source))
    .slice(0, limit)
    .map(({ asset, source }) => ({
      id: asset.id,
      description: asset.description?.trim() || source.title,
      tags: asset.tags,
    }));
}

/** True when this asset may be used on a slide right now (the check generate-assets repeats). */
export async function assertLibraryPhotoUsable(
  ctx: ServiceContext,
  assetId: string,
): Promise<void> {
  const usable = (await listLibraryCandidates(ctx, 1000)).some((c) => c.id === assetId);
  if (!usable) {
    throw new PermanentError("The library photo is not available (rights, status or source).", {
      details: { assetId },
    });
  }
}
