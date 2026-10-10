import { schema } from "@rc/db";
import type { RightsPolicy } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { createLogger } from "@rc/lib/logging";
import { gradientPng } from "@rc/lib/providers/image";
import { createMemoryStorage } from "@rc/lib/providers/storage";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, manualClock, type ServiceContext } from "../../core";
import {
  importLibraryPhoto,
  listLibraryCandidates,
  normalizeTags,
  updateLibraryPhoto,
} from "./index";

// Synthetic photos only.

const rights = (over: Partial<RightsPolicy> = {}): RightsPolicy => ({
  use: "ALLOWED",
  translate: "ALLOWED",
  adapt: "ALLOWED",
  visuallyTransform: "ALLOWED",
  sell: "UNKNOWN",
  aiProcessing: "DENIED",
  improvePrompts: "DENIED",
  ...over,
});

describe("photo library", () => {
  let t: TestDb;
  let ctx: ServiceContext;
  let storage: ReturnType<typeof createMemoryStorage>;
  let brandId: string;

  const makeSource = async (
    over: Partial<typeof schema.sourceAssets.$inferInsert> = {},
    bytes?: Uint8Array,
  ) => {
    const [source] = await t.db
      .insert(schema.sourceAssets)
      .values({
        brandId,
        type: "PHOTO",
        title: "Rice bowl",
        originalLanguage: "ru",
        rights: rights(),
        fileKey: `sources/${crypto.randomUUID()}/rice.png`,
        originalFilename: "rice.png",
        mimeType: "image/png",
        fileSizeBytes: 1,
        processingStatus: "QUEUED",
        processingAttempt: 1,
        ...over,
      })
      .returning();
    await storage.put(source?.fileKey ?? "", bytes ?? gradientPng(300, 200, "rice"), {
      contentType: "image/png",
    });
    return source as typeof schema.sourceAssets.$inferSelect;
  };
  const assetOf = async (sourceId: string) => {
    const [row] = await t.db
      .select()
      .from(schema.visualAssets)
      .where(eq(schema.visualAssets.sourceAssetId, sourceId));
    return row;
  };
  const sourceRow = async (id: string) => {
    const [row] = await t.db
      .select()
      .from(schema.sourceAssets)
      .where(eq(schema.sourceAssets.id, id));
    return row as typeof schema.sourceAssets.$inferSelect;
  };

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    const [brand] = await t.db.select().from(schema.brands);
    brandId = brand?.id ?? "";
    storage = createMemoryStorage();
    ctx = createServiceContext({
      db: t.db,
      logger: createLogger({
        service: "jobs",
        env: "test",
        level: "fatal",
        destination: { write: () => {} },
      }),
      clock: manualClock("2026-10-10T12:00:00Z"),
      storage,
      actor: { type: "SYSTEM" },
    });
  });

  afterEach(async () => {
    await t.close();
  });

  describe("importLibraryPhoto", () => {
    it("makes a READY library photo with the stored WebP, size, hash and the source's rights", async () => {
      const source = await makeSource({
        metadataJson: { description: "A bowl of rice", tags: [" Rice ", "BOWL", "rice"] },
      });
      const result = await importLibraryPhoto(ctx, { sourceAssetId: source.id, attempt: 1 });
      expect(result).toMatchObject({ status: "READY", width: 300, height: 200 });
      const asset = await assetOf(source.id);
      expect(asset).toMatchObject({
        kind: "LIBRARY_PHOTO",
        status: "READY",
        isAiGenerated: false,
        mimeType: "image/webp",
        description: "A bowl of rice",
        tags: ["rice", "bowl"],
        originalKey: source.fileKey,
        rights: rights(),
      });
      expect(asset?.storageKey).toBe(`library/${asset?.id}.webp`);
      expect(asset?.phash).toMatch(/^[0-9a-f]{16}$/);
      const meta = await sharp(await storage.getBytes(asset?.storageKey ?? "")).metadata();
      expect(meta).toMatchObject({ format: "webp", width: 300, height: 200 });
      expect((await sourceRow(source.id)).processingStatus).toBe("READY");
    });

    it("shrinks a large photo to 2160 px on the long side and never enlarges", async () => {
      const big = await sharp({
        create: { width: 3000, height: 1500, channels: 3, background: "#884422" },
      })
        .jpeg()
        .toBuffer();
      const source = await makeSource({ originalFilename: "big.jpg", mimeType: "image/jpeg" }, big);
      expect(await importLibraryPhoto(ctx, { sourceAssetId: source.id, attempt: 1 })).toMatchObject(
        {
          width: 2160,
          height: 1080,
        },
      );
    });

    it("is safe to repeat and ignores a stale attempt", async () => {
      const source = await makeSource();
      await importLibraryPhoto(ctx, { sourceAssetId: source.id, attempt: 1 });
      expect(await importLibraryPhoto(ctx, { sourceAssetId: source.id, attempt: 1 })).toEqual({
        status: "SKIPPED",
        reason: "ALREADY_DONE",
      });
      const other = await makeSource();
      expect(await importLibraryPhoto(ctx, { sourceAssetId: other.id, attempt: 9 })).toEqual({
        status: "SKIPPED",
        reason: "STALE_ATTEMPT",
      });
      expect(await t.db.select().from(schema.visualAssets)).toHaveLength(1);
    });

    it("ends the source as FAILED when the file is not an image", async () => {
      const source = await makeSource({}, new TextEncoder().encode("not an image"));
      expect(await importLibraryPhoto(ctx, { sourceAssetId: source.id, attempt: 1 })).toEqual({
        status: "FAILED",
        code: "NOT_AN_IMAGE",
      });
      expect(await sourceRow(source.id)).toMatchObject({
        processingStatus: "FAILED",
        processingError: { code: "NOT_AN_IMAGE" },
      });
      expect(await assetOf(source.id)).toBeUndefined();
    });

    it("refuses a source that is not a photo", async () => {
      const source = await makeSource({ type: "GUIDE" });
      await expect(
        importLibraryPhoto(ctx, { sourceAssetId: source.id, attempt: 1 }),
      ).rejects.toThrow("Only PHOTO sources");
    });
  });

  describe("candidates for the visual director", () => {
    const importOne = async (over: Partial<typeof schema.sourceAssets.$inferInsert> = {}) => {
      const source = await makeSource(over);
      await importLibraryPhoto(ctx, { sourceAssetId: source.id, attempt: 1 });
      return {
        source,
        asset: (await assetOf(source.id)) as typeof schema.visualAssets.$inferSelect,
      };
    };

    it("lists a READY photo whose rights allow a visual transform, with its description and tags", async () => {
      const { asset } = await importOne({ metadataJson: { description: "Rice", tags: ["rice"] } });
      expect(await listLibraryCandidates(ctx)).toEqual([
        { id: asset.id, description: "Rice", tags: ["rice"] },
      ]);
    });

    it("falls back to the source title without a description", async () => {
      await importOne({ title: "Pasta water" });
      expect((await listLibraryCandidates(ctx))[0]?.description).toBe("Pasta water");
    });

    it("leaves out photos whose rights do not allow it, even after a later change", async () => {
      const denied = await importOne({ rights: rights({ visuallyTransform: "UNKNOWN" }) });
      const restricted = await importOne({ rightsStatus: "RESTRICTED" });
      const ok = await importOne();
      expect((await listLibraryCandidates(ctx)).map((c) => c.id)).toEqual([ok.asset.id]);
      // The source's rights are the truth: changing them changes the list.
      await t.db
        .update(schema.sourceAssets)
        .set({ rights: rights({ visuallyTransform: "ALLOWED" }) })
        .where(eq(schema.sourceAssets.id, denied.source.id));
      expect((await listLibraryCandidates(ctx)).map((c) => c.id).sort()).toEqual(
        [denied.asset.id, ok.asset.id].sort(),
      );
      expect(restricted.asset.id).toBeTruthy();
    });

    it("leaves out rejected photos and photos of an archived source", async () => {
      const a = await importOne();
      const b = await importOne();
      await updateLibraryPhoto(ctx, { assetId: a.asset.id, status: "REJECTED" });
      await t.db
        .update(schema.sourceAssets)
        .set({ archivedAt: new Date() })
        .where(eq(schema.sourceAssets.id, b.source.id));
      expect(await listLibraryCandidates(ctx)).toEqual([]);
      await updateLibraryPhoto(ctx, { assetId: a.asset.id, status: "READY" });
      expect((await listLibraryCandidates(ctx)).map((c) => c.id)).toEqual([a.asset.id]);
    });
  });

  describe("updateLibraryPhoto", () => {
    it("sets the description and normalized tags and audits it", async () => {
      const source = await makeSource();
      await importLibraryPhoto(ctx, { sourceAssetId: source.id, attempt: 1 });
      const asset = await assetOf(source.id);
      await updateLibraryPhoto(ctx, {
        assetId: asset?.id ?? "",
        description: "  Macro of rice  ",
        tags: ["Rice", " rice ", "Macro", ""],
      });
      expect(await assetOf(source.id)).toMatchObject({
        description: "Macro of rice",
        tags: ["rice", "macro"],
      });
      expect((await t.db.select().from(schema.auditEvents)).map((a) => a.action)).toContain(
        "library_photo.updated",
      );
    });

    it("refuses an asset that is not a library photo", async () => {
      const [generated] = await t.db
        .insert(schema.visualAssets)
        .values({ brandId, kind: "GENERATED" })
        .returning();
      await expect(
        updateLibraryPhoto(ctx, { assetId: generated?.id ?? "", description: "x" }),
      ).rejects.toThrow("Library photo not found");
    });
  });

  it("normalizes tags: lower case, trimmed, unique, at most 12", () => {
    expect(normalizeTags([" A ", "a", "B", ""])).toEqual(["a", "b"]);
    expect(normalizeTags(Array.from({ length: 30 }, (_, i) => `t${i}`))).toHaveLength(12);
  });
});
