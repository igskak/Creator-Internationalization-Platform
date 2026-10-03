import { schema } from "@rc/db";
import type { RightsPolicy } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { ForbiddenError, InvalidStateError, ValidationError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { createMemoryStorage } from "@rc/lib/providers/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, type JobRunner, manualClock, type ServiceContext } from "../../core";
import {
  archiveSource,
  completeSourceUpload,
  createSourceUpload,
  createTextSource,
  getSourceDownloadUrl,
  updateSourceRights,
} from "./index";

const logger = createLogger({
  service: "web",
  env: "test",
  level: "fatal",
  destination: { write: () => {} },
});

const allowed: RightsPolicy = {
  use: "ALLOWED",
  translate: "ALLOWED",
  adapt: "ALLOWED",
  visuallyTransform: "UNKNOWN",
  sell: "UNKNOWN",
  aiProcessing: "ALLOWED",
  improvePrompts: "UNKNOWN",
};
const unknown: RightsPolicy = { ...allowed, aiProcessing: "UNKNOWN" };

const PDF = "application/pdf";
const upload = (patch: Record<string, unknown> = {}) => ({
  type: "GUIDE" as const,
  title: "Synthetic guide",
  fileName: "guide.pdf",
  mimeType: PDF,
  sizeBytes: 1000,
  originalLanguage: "ru",
  rights: allowed,
  ...patch,
});

describe("source upload services", () => {
  let t: TestDb;
  let ctx: ServiceContext;
  let storage: ReturnType<typeof createMemoryStorage>;
  let triggered: { name: string; payload: unknown; idempotencyKey: string | undefined }[];
  let ownerId: string;
  const clock = manualClock("2026-10-03T10:00:00Z");

  const source = async (id: string) => {
    const [row] = await t.db
      .select()
      .from(schema.sourceAssets)
      .where(eq(schema.sourceAssets.id, id));
    if (!row) throw new Error("missing");
    return row;
  };
  const audits = async () =>
    (await t.db.select().from(schema.auditEvents).orderBy(schema.auditEvents.id)).map(
      (e) => e.action,
    );
  const put = (key: string, size: number) =>
    storage.put(key, new Uint8Array(size), { contentType: PDF });

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    const [owner] = await t.db.select().from(schema.appUsers);
    ownerId = owner?.id ?? "";
    storage = createMemoryStorage();
    triggered = [];
    const jobs: JobRunner = {
      trigger: async (name, payload, options) => {
        triggered.push({ name, payload, idempotencyKey: options?.idempotencyKey });
        return { runId: "run-1" };
      },
      triggerAndWaitAll: async () => [],
    };
    ctx = createServiceContext({
      db: t.db,
      logger,
      clock,
      jobs,
      storage,
      actor: { type: "USER", userId: ownerId, role: "owner" },
    });
  });
  afterEach(async () => {
    await t.close();
  });

  describe("createSourceUpload", () => {
    it("registers a PENDING_UPLOAD asset and returns a bound presigned PUT", async () => {
      const result = await createSourceUpload(ctx, upload());
      const row = await source(result.sourceAssetId);
      expect(row).toMatchObject({
        processingStatus: "PENDING_UPLOAD",
        type: "GUIDE",
        fileSizeBytes: 1000,
        originalFilename: "guide.pdf",
        createdBy: ownerId,
        rights: allowed,
      });
      expect(row.fileKey).toBe(`sources/${row.id}/guide.pdf`);
      expect(result.uploadUrl).toContain(encodeURI(row.fileKey ?? ""));
      expect(result.uploadHeaders["Content-Type"]).toBe(PDF);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("never stores a confirmation supplied by the uploader", async () => {
      const result = await createSourceUpload(
        ctx,
        upload({
          rights: { ...allowed, confirmedBy: ownerId, confirmedAt: "2026-01-01T00:00:00Z" },
        }),
      );
      expect((await source(result.sourceAssetId)).rights).toEqual(allowed);
    });

    it.each([
      ["wrong extension", { fileName: "guide.exe" }, "fileName"],
      ["mime mismatch", { mimeType: "text/html" }, "mimeType"],
      ["empty file", { sizeBytes: 0 }, "sizeBytes"],
      ["PDF over 200 MB", { sizeBytes: 200 * 1024 * 1024 + 1 }, "sizeBytes"],
      [
        "DOCX over 50 MB",
        {
          fileName: "g.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          sizeBytes: 50 * 1024 * 1024 + 1,
        },
        "sizeBytes",
      ],
      ["video", { type: "VIDEO", fileName: "v.mp4", mimeType: "video/mp4" }, "type"],
      ["bad language", { originalLanguage: "russian" }, "originalLanguage"],
    ])("rejects %s", async (_name, patch, field) => {
      const error = await createSourceUpload(ctx, upload(patch)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).fieldErrors).toHaveProperty(field);
      expect(await t.db.select().from(schema.sourceAssets)).toHaveLength(0);
    });

    it("accepts text, markdown and subtitle formats for their types", async () => {
      await createSourceUpload(ctx, upload({ fileName: "a.md", mimeType: "text/markdown" }));
      await createSourceUpload(
        ctx,
        upload({ type: "TRANSCRIPT", fileName: "a.srt", mimeType: "application/x-subrip" }),
      );
      await expect(
        createSourceUpload(ctx, upload({ type: "NOTE", fileName: "a.pdf" })),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("completeSourceUpload", () => {
    it("queues ingestion when AI processing is allowed", async () => {
      const { sourceAssetId } = await createSourceUpload(ctx, upload());
      const row = await source(sourceAssetId);
      await put(row.fileKey ?? "", 1000);

      expect(await completeSourceUpload(ctx, { sourceAssetId })).toEqual({ status: "QUEUED" });
      expect(await source(sourceAssetId)).toMatchObject({
        processingStatus: "QUEUED",
        processingAttempt: 1,
      });
      expect(triggered).toEqual([
        {
          name: "ingest-source",
          payload: { sourceAssetId, attempt: 1 },
          idempotencyKey: `ingest:${sourceAssetId}:1`,
        },
      ]);
      expect(await audits()).toEqual(["source.uploaded"]);
    });

    it("blocks the source and starts no job when AI processing is not allowed", async () => {
      const { sourceAssetId } = await createSourceUpload(ctx, upload({ rights: unknown }));
      await put((await source(sourceAssetId)).fileKey ?? "", 1000);

      expect(await completeSourceUpload(ctx, { sourceAssetId })).toEqual({ status: "BLOCKED" });
      expect((await source(sourceAssetId)).processingStatus).toBe("BLOCKED");
      expect(triggered).toHaveLength(0);
      expect(await audits()).toEqual(["source.uploaded"]);
    });

    it("fails the source and removes the object on a size mismatch", async () => {
      const { sourceAssetId } = await createSourceUpload(ctx, upload());
      const key = (await source(sourceAssetId)).fileKey ?? "";
      await put(key, 999);

      await expect(completeSourceUpload(ctx, { sourceAssetId })).rejects.toBeInstanceOf(
        ValidationError,
      );
      expect(await source(sourceAssetId)).toMatchObject({
        processingStatus: "FAILED",
        processingError: expect.objectContaining({ code: "SIZE_MISMATCH" }),
      });
      expect(await storage.head(key)).toBeNull();
      expect(triggered).toHaveLength(0);
      expect(await audits()).toEqual(["source.failed"]);
    });

    it("asks to upload when the object is missing and leaves the source retryable", async () => {
      const { sourceAssetId } = await createSourceUpload(ctx, upload());
      await expect(completeSourceUpload(ctx, { sourceAssetId })).rejects.toBeInstanceOf(
        ValidationError,
      );
      expect((await source(sourceAssetId)).processingStatus).toBe("PENDING_UPLOAD");
    });

    it("is idempotent once queued and refuses other states", async () => {
      const { sourceAssetId } = await createSourceUpload(ctx, upload());
      await put((await source(sourceAssetId)).fileKey ?? "", 1000);
      await completeSourceUpload(ctx, { sourceAssetId });
      expect(await completeSourceUpload(ctx, { sourceAssetId })).toEqual({ status: "QUEUED" });
      expect(triggered).toHaveLength(1);

      await t.db
        .update(schema.sourceAssets)
        .set({ processingStatus: "READY" })
        .where(eq(schema.sourceAssets.id, sourceAssetId));
      await expect(completeSourceUpload(ctx, { sourceAssetId })).rejects.toBeInstanceOf(
        InvalidStateError,
      );
    });
  });

  describe("createTextSource", () => {
    it("stores the text, queues ingestion and records the size", async () => {
      const result = await createTextSource(ctx, {
        type: "NOTE",
        title: "Chef note",
        text: "Привет, мир",
        originalLanguage: "ru",
        rights: allowed,
      });
      expect(result.status).toBe("QUEUED");
      const row = await source(result.sourceAssetId);
      expect(row).toMatchObject({ mimeType: "text/plain", fileSizeBytes: 20 });
      expect(new TextDecoder().decode(await storage.getBytes(row.fileKey ?? ""))).toBe(
        "Привет, мир",
      );
      expect(triggered).toHaveLength(1);
    });

    it("blocks without AI rights and rejects text over 200k characters", async () => {
      const blocked = await createTextSource(ctx, {
        type: "RECIPE",
        title: "r",
        text: "x",
        originalLanguage: "ru",
        rights: unknown,
      });
      expect(blocked.status).toBe("BLOCKED");
      expect(triggered).toHaveLength(0);
      await expect(
        createTextSource(ctx, {
          type: "NOTE",
          title: "big",
          text: "x".repeat(200_001),
          originalLanguage: "ru",
          rights: allowed,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(storage.keys()).toHaveLength(1);
    });
  });

  describe("updateSourceRights", () => {
    it("confirms rights, audits, and queues a BLOCKED source that is now allowed", async () => {
      const { sourceAssetId } = await createSourceUpload(ctx, upload({ rights: unknown }));
      await put((await source(sourceAssetId)).fileKey ?? "", 1000);
      await completeSourceUpload(ctx, { sourceAssetId });

      const updated = await updateSourceRights(ctx, {
        sourceAssetId,
        rights: allowed,
        rightsStatus: "CLEARED",
      });
      expect(updated).toMatchObject({
        processingStatus: "QUEUED",
        rightsStatus: "CLEARED",
        processingAttempt: 1,
        rights: { ...allowed, confirmedBy: ownerId, confirmedAt: "2026-10-03T10:00:00.000Z" },
      });
      expect(triggered).toEqual([
        expect.objectContaining({
          name: "ingest-source",
          idempotencyKey: `ingest:${sourceAssetId}:1`,
        }),
      ]);
      expect(await audits()).toEqual([
        "source.uploaded",
        "source.rights_changed",
        "source.unblocked",
      ]);
    });

    it("keeps a source BLOCKED when the new rights still forbid AI, and for RESTRICTED", async () => {
      const { sourceAssetId } = await createSourceUpload(ctx, upload({ rights: unknown }));
      await put((await source(sourceAssetId)).fileKey ?? "", 1000);
      await completeSourceUpload(ctx, { sourceAssetId });
      await updateSourceRights(ctx, {
        sourceAssetId,
        rights: allowed,
        rightsStatus: "RESTRICTED",
      });
      expect((await source(sourceAssetId)).processingStatus).toBe("BLOCKED");
      expect(triggered).toHaveLength(0);
    });

    it("is owner-only", async () => {
      const { sourceAssetId } = await createSourceUpload(ctx, upload());
      const editor = { ...ctx, actor: { type: "USER", userId: ownerId, role: "editor" } } as const;
      await expect(
        updateSourceRights(editor, { sourceAssetId, rights: allowed, rightsStatus: "CLEARED" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("archiveSource", () => {
    it("archives with an audit reason, frees the checksum slot, and is idempotent", async () => {
      const { sourceAssetId } = await createSourceUpload(ctx, upload({ rights: unknown }));
      await archiveSource(ctx, { sourceAssetId, reason: "wrong file" });
      expect((await source(sourceAssetId)).archivedAt).toEqual(clock.now());
      await archiveSource(ctx, { sourceAssetId, reason: "again" });
      expect(await audits()).toEqual(["source.archived"]);
      const [event] = await t.db.select().from(schema.auditEvents);
      expect(event?.data).toEqual({ reason: "wrong file" });
    });

    it("refuses while the source is queued or processing, and for non-owners", async () => {
      const { sourceAssetId } = await createSourceUpload(ctx, upload());
      await put((await source(sourceAssetId)).fileKey ?? "", 1000);
      await completeSourceUpload(ctx, { sourceAssetId });
      await expect(archiveSource(ctx, { sourceAssetId, reason: "x" })).rejects.toBeInstanceOf(
        InvalidStateError,
      );
      const chef = { ...ctx, actor: { type: "USER", userId: ownerId, role: "chef" } } as const;
      await expect(archiveSource(chef, { sourceAssetId, reason: "x" })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });
  });

  describe("getSourceDownloadUrl", () => {
    it("returns a presigned GET and appends #page for PDFs only", async () => {
      const { sourceAssetId } = await createSourceUpload(ctx, upload());
      await expect(getSourceDownloadUrl(ctx, { sourceAssetId })).rejects.toBeInstanceOf(
        InvalidStateError,
      );
      await put((await source(sourceAssetId)).fileKey ?? "", 1000);
      await completeSourceUpload(ctx, { sourceAssetId });

      const plain = await getSourceDownloadUrl(ctx, { sourceAssetId });
      expect(plain.url).toContain("op=get");
      expect((await getSourceDownloadUrl(ctx, { sourceAssetId, page: 7 })).url).toMatch(/#page=7$/);

      const text = await createTextSource(ctx, {
        type: "NOTE",
        title: "n",
        text: "x",
        originalLanguage: "ru",
        rights: allowed,
      });
      expect(
        (await getSourceDownloadUrl(ctx, { sourceAssetId: text.sourceAssetId, page: 2 })).url,
      ).not.toContain("#page");
    });
  });
});
