import { createHash, randomUUID } from "node:crypto";
import { schema } from "@rc/db";
import { RightsPolicy, SOURCE_TYPES, type SourceType } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { ForbiddenError, InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { PRESIGN_TTL, storageKeys } from "@rc/lib/providers/storage";
import { z } from "zod";
import { audit, type ServiceContext, transition, triggerJob, withTransaction } from "../../core";
import { canProcessWithAI } from "../rights";
import { checkUploadAllowed, fileExtension, MAX_TEXT_CHARS } from "./limits";

// Source upload backend (plan 05 §5.3, 06 J1). Rights are enforced here only to choose
// QUEUED vs BLOCKED; `ingest-source` checks the gate again before any model call.

export type SourceAsset = typeof schema.sourceAssets.$inferSelect;

const SourceTypeSchema = z.enum(SOURCE_TYPES);
const Language = z.string().regex(/^[a-z]{2}$/, "Use an ISO 639-1 code like 'ru'.");
const Title = z.string().trim().min(1).max(200);

/** Confirmation is set by `updateSourceRights`, never by the uploader. */
const stripConfirmation = (rights: RightsPolicy): RightsPolicy => {
  const { confirmedBy: _by, confirmedAt: _at, ...rest } = rights;
  return rest;
};

export const CreateSourceUploadInput = z.object({
  type: SourceTypeSchema,
  title: Title,
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int(),
  originalLanguage: Language,
  sourceAuthor: z.string().trim().max(200).optional(),
  rights: RightsPolicy,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const CreateTextSourceInput = z.object({
  type: z.enum(["NOTE", "TRANSCRIPT", "RECIPE"]),
  title: Title,
  text: z.string().min(1).max(MAX_TEXT_CHARS),
  originalLanguage: Language,
  sourceAuthor: z.string().trim().max(200).optional(),
  rights: RightsPolicy,
});

export const SourceIdInput = z.object({ sourceAssetId: z.uuid() });
export const UpdateSourceRightsInput = z.object({
  sourceAssetId: z.uuid(),
  rights: RightsPolicy,
  rightsStatus: z.enum(["UNKNOWN", "PENDING_REVIEW", "CLEARED", "RESTRICTED"]),
});
export const ArchiveSourceInput = z.object({
  sourceAssetId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
});
export const GetSourceDownloadUrlInput = z.object({
  sourceAssetId: z.uuid(),
  page: z.number().int().positive().optional(),
});

async function brandId(ctx: ServiceContext): Promise<string> {
  const [brand] = await ctx.db.select({ id: schema.brands.id }).from(schema.brands).limit(1);
  if (!brand) throw new NotFoundError("Brand is not set up.");
  return brand.id;
}

async function loadSource(ctx: ServiceContext, id: string): Promise<SourceAsset> {
  const [row] = await ctx.db
    .select()
    .from(schema.sourceAssets)
    .where(eq(schema.sourceAssets.id, id));
  if (!row) throw new NotFoundError("Source not found.", { details: { sourceAssetId: id } });
  return row;
}

const actingUserId = (ctx: ServiceContext) => (ctx.actor.type === "USER" ? ctx.actor.userId : null);

/** `createSourceUpload`: registers the asset and returns a presigned PUT bound to type and size. */
export async function createSourceUpload(
  ctx: ServiceContext,
  raw: z.input<typeof CreateSourceUploadInput>,
): Promise<{
  sourceAssetId: string;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  expiresAt: Date;
}> {
  const input = parseInput(CreateSourceUploadInput, raw);
  checkUploadAllowed(input.type, input.fileName, input.mimeType, input.sizeBytes);

  const id = randomUUID();
  const fileKey = storageKeys.source(id, input.fileName);
  const brand = await brandId(ctx);
  await ctx.db.insert(schema.sourceAssets).values({
    id,
    brandId: brand,
    type: input.type,
    title: input.title,
    fileKey,
    originalFilename: input.fileName,
    mimeType: input.mimeType,
    fileSizeBytes: input.sizeBytes,
    originalLanguage: input.originalLanguage,
    sourceAuthor: input.sourceAuthor ?? null,
    rights: stripConfirmation(input.rights),
    metadataJson: input.metadata ?? {},
    createdBy: actingUserId(ctx),
  });
  const upload = await ctx.storage.presignPut(fileKey, {
    contentType: input.mimeType,
    contentLength: input.sizeBytes,
    expiresInSeconds: PRESIGN_TTL.upload,
  });
  return {
    sourceAssetId: id,
    uploadUrl: upload.url,
    uploadHeaders: upload.headers,
    expiresAt: upload.expiresAt,
  };
}

/**
 * `completeSourceUpload`: checks the object exists with the declared size, then queues
 * `ingest-source` (rights allow AI processing) or marks the source BLOCKED. Safe to call again.
 */
export async function completeSourceUpload(
  ctx: ServiceContext,
  raw: z.input<typeof SourceIdInput>,
): Promise<{ status: "QUEUED" | "BLOCKED" }> {
  const { sourceAssetId } = parseInput(SourceIdInput, raw);
  const source = await loadSource(ctx, sourceAssetId);
  if (source.archivedAt) throw new InvalidStateError("This source is archived.");
  if (source.processingStatus === "QUEUED" || source.processingStatus === "BLOCKED") {
    return { status: source.processingStatus };
  }
  if (source.processingStatus !== "PENDING_UPLOAD") {
    throw new InvalidStateError(`Cannot complete an upload in status ${source.processingStatus}.`);
  }
  if (!source.fileKey) throw new InvalidStateError("The source has no file.");

  const info = await ctx.storage.head(source.fileKey);
  if (!info) {
    throw new ValidationError("The file was not uploaded. Upload it, then try again.", {
      fieldErrors: { file: ["Upload not found."] },
    });
  }
  if (info.size !== source.fileSizeBytes) {
    await failUpload(ctx, source, "SIZE_MISMATCH", {
      declaredBytes: source.fileSizeBytes,
      uploadedBytes: info.size,
    });
    throw new ValidationError("The uploaded file does not match the declared size.", {
      fieldErrors: { file: ["Size mismatch. Upload the file again."] },
    });
  }
  return queueOrBlock(ctx, source, "source.uploaded");
}

/** `createTextSource`: stores pasted text as `.txt`, then follows the same path as an upload. */
export async function createTextSource(
  ctx: ServiceContext,
  raw: z.input<typeof CreateTextSourceInput>,
): Promise<{ sourceAssetId: string; status: "QUEUED" | "BLOCKED" }> {
  const input = parseInput(CreateTextSourceInput, raw);
  const bytes = new TextEncoder().encode(input.text);
  const id = randomUUID();
  const fileKey = storageKeys.source(id, "text.txt");
  const brand = await brandId(ctx);

  await ctx.storage.put(fileKey, bytes, { contentType: "text/plain" });
  const [source] = await ctx.db
    .insert(schema.sourceAssets)
    .values({
      id,
      brandId: brand,
      type: input.type,
      title: input.title,
      fileKey,
      originalFilename: "text.txt",
      mimeType: "text/plain",
      fileSizeBytes: bytes.byteLength,
      originalLanguage: input.originalLanguage,
      sourceAuthor: input.sourceAuthor ?? null,
      rights: stripConfirmation(input.rights),
      metadataJson: { pasted: true, sha256: createHash("sha256").update(bytes).digest("hex") },
      createdBy: actingUserId(ctx),
    })
    .returning();
  if (!source) throw new Error("createTextSource: insert returned no row");
  const { status } = await queueOrBlock(ctx, source, "source.uploaded");
  return { sourceAssetId: id, status };
}

/**
 * `updateSourceRights` (owner): records who confirmed and when; a BLOCKED source whose rights now
 * allow AI processing is queued.
 */
export async function updateSourceRights(
  ctx: ServiceContext,
  raw: z.input<typeof UpdateSourceRightsInput>,
): Promise<SourceAsset> {
  if (ctx.actor.type === "USER" && ctx.actor.role !== "owner") throw new ForbiddenError();
  const input = parseInput(UpdateSourceRightsInput, raw);
  const source = await loadSource(ctx, input.sourceAssetId);
  const rights: RightsPolicy = {
    ...stripConfirmation(input.rights),
    ...(ctx.actor.type === "USER"
      ? { confirmedBy: ctx.actor.userId, confirmedAt: ctx.clock.now().toISOString() }
      : {}),
  };

  const updated = await withTransaction(ctx, async (tx) => {
    const [row] = await tx.db
      .update(schema.sourceAssets)
      .set({ rights, rightsStatus: input.rightsStatus })
      .where(eq(schema.sourceAssets.id, source.id))
      .returning();
    await audit(tx, {
      action: "source.rights_changed",
      entityType: "source_asset",
      entityId: source.id,
      data: {
        rightsStatus: { from: source.rightsStatus, to: input.rightsStatus },
        aiProcessing: { from: source.rights.aiProcessing, to: rights.aiProcessing },
        rights,
      },
    });
    return row ?? source;
  });

  if (updated.processingStatus === "BLOCKED" && canProcessWithAI(updated)) {
    await queue(ctx, updated, "source.unblocked");
    return loadSource(ctx, source.id);
  }
  return updated;
}

/**
 * `archiveSource` (owner): hides the source and keeps its lineage. A source being processed
 * cannot be archived. TODO(M2-01a): refuse while an approved card is used by a live idea.
 */
export async function archiveSource(
  ctx: ServiceContext,
  raw: z.input<typeof ArchiveSourceInput>,
): Promise<{ ok: true }> {
  if (ctx.actor.type === "USER" && ctx.actor.role !== "owner") throw new ForbiddenError();
  const input = parseInput(ArchiveSourceInput, raw);
  const source = await loadSource(ctx, input.sourceAssetId);
  if (source.archivedAt) return { ok: true };
  if (source.processingStatus === "PROCESSING" || source.processingStatus === "QUEUED") {
    throw new InvalidStateError("Wait until processing finishes before archiving this source.");
  }
  await withTransaction(ctx, async (tx) => {
    await tx.db
      .update(schema.sourceAssets)
      .set({ archivedAt: ctx.clock.now() })
      .where(eq(schema.sourceAssets.id, source.id));
    await audit(tx, {
      action: "source.archived",
      entityType: "source_asset",
      entityId: source.id,
      data: { reason: input.reason },
    });
  });
  return { ok: true };
}

/** `getSourceDownloadUrl`: presigned GET (10 min); PDFs open at `page`. */
export async function getSourceDownloadUrl(
  ctx: ServiceContext,
  raw: z.input<typeof GetSourceDownloadUrlInput>,
): Promise<{ url: string; expiresAt: Date }> {
  const input = parseInput(GetSourceDownloadUrlInput, raw);
  const source = await loadSource(ctx, input.sourceAssetId);
  if (!source.fileKey || source.processingStatus === "PENDING_UPLOAD") {
    throw new InvalidStateError("This source has no uploaded file.");
  }
  const download = await ctx.storage.presignGet(source.fileKey, {
    expiresInSeconds: PRESIGN_TTL.sourceDownload,
    ...(source.originalFilename ? { downloadFileName: source.originalFilename } : {}),
  });
  const isPdf = fileExtension(source.originalFilename ?? "") === "pdf";
  return {
    url: input.page && isPdf ? `${download.url}#page=${input.page}` : download.url,
    expiresAt: download.expiresAt,
  };
}

// --- internals ---------------------------------------------------------------------------

function parseInput<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  return parsed.data;
}

async function failUpload(
  ctx: ServiceContext,
  source: SourceAsset,
  code: string,
  details: Record<string, unknown>,
): Promise<void> {
  if (source.fileKey) await ctx.storage.delete(source.fileKey);
  await transition(ctx, {
    table: schema.sourceAssets,
    statusKey: "processingStatus",
    id: source.id,
    from: ["PENDING_UPLOAD"],
    to: "FAILED",
    set: { processingError: { code, message: "Upload check failed.", details } },
    audit: { action: "source.failed", entityType: "source_asset", data: { code, ...details } },
  });
}

/** After the object is in storage: QUEUED + job when AI processing is allowed, else BLOCKED. */
async function queueOrBlock(
  ctx: ServiceContext,
  source: SourceAsset,
  action: string,
): Promise<{ status: "QUEUED" | "BLOCKED" }> {
  if (!canProcessWithAI(source)) {
    await transition(ctx, {
      table: schema.sourceAssets,
      statusKey: "processingStatus",
      id: source.id,
      from: ["PENDING_UPLOAD"],
      to: "BLOCKED",
      audit: {
        action,
        entityType: "source_asset",
        data: { type: source.type satisfies SourceType, blocked: "RIGHTS" },
      },
    });
    return { status: "BLOCKED" };
  }
  await queue(ctx, source, action);
  return { status: "QUEUED" };
}

/** PENDING_UPLOAD or BLOCKED → QUEUED with the next processing attempt, then triggers the job. */
async function queue(ctx: ServiceContext, source: SourceAsset, action: string): Promise<void> {
  const attempt = source.processingAttempt + 1;
  await transition(ctx, {
    table: schema.sourceAssets,
    statusKey: "processingStatus",
    id: source.id,
    from: ["PENDING_UPLOAD", "BLOCKED"],
    to: "QUEUED",
    set: { processingAttempt: attempt },
    audit: { action, entityType: "source_asset", data: { type: source.type, attempt } },
  });
  await triggerJob(
    ctx,
    "ingest-source",
    { sourceAssetId: source.id, attempt },
    { idempotencyKey: `ingest:${source.id}:${attempt}` },
  );
}
