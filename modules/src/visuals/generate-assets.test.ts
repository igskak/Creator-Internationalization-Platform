import { schema } from "@rc/db";
import type { Slide, VisualBrief } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { InvalidStateError, TransientError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { createFakeImageProvider } from "@rc/lib/providers/image";
import { createMemoryStorage } from "@rc/lib/providers/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, manualClock, type ServiceContext } from "../core";
import { generateVisualAssets } from "./generate-assets";

// Integration tests with the fake image provider and in-memory storage. Synthetic content only.

const slide = (id: string, index: number, templateId: string, role: string): Slide => ({
  id,
  index,
  role: role as Slide["role"],
  templateId: templateId as Slide["templateId"],
  slots: { headline: "x" },
  images: {},
  knowledgeIds: [],
  factual: false,
});
const entry = (
  slideId: string,
  slot: string,
  over: Partial<VisualBrief["slides"][number]> = {},
) => ({
  slideId,
  slot,
  source: "GENERATE" as const,
  prompt: `Macro photo for ${slideId}/${slot}`,
  negativePrompt: "text",
  composition: "Low.",
  aspect: (slot === "hero" ? "4:5" : "1:1") as "4:5" | "1:1",
  ...over,
});
const brief = (slides: VisualBrief["slides"]): VisualBrief => ({
  concept: "c",
  visualStyle: "WARM_RUSTIC",
  slides,
  differentiationFromSibling: "",
});

describe("generateVisualAssets", () => {
  let t: TestDb;
  let ctx: ServiceContext;
  let images: ReturnType<typeof createFakeImageProvider>;
  let storage: ReturnType<typeof createMemoryStorage>;
  let variantId: string;
  let failOn: (label: string | undefined, call: number) => Error | undefined;

  const makeCtx = () =>
    createServiceContext({
      db: t.db,
      logger: createLogger({
        service: "jobs",
        env: "test",
        level: "fatal",
        destination: { write: () => {} },
      }),
      clock: manualClock("2026-10-10T12:00:00Z"),
      images,
      storage,
      actor: { type: "SYSTEM" },
    });
  const variant = async () => {
    const [v] = await t.db
      .select()
      .from(schema.contentVariants)
      .where(eq(schema.contentVariants.id, variantId));
    return v as typeof schema.contentVariants.$inferSelect;
  };
  const assets = () => t.db.select().from(schema.visualAssets);
  const setBrief = (slides: VisualBrief["slides"]) =>
    t.db
      .update(schema.contentVariants)
      .set({ visualBriefJson: brief(slides) })
      .where(eq(schema.contentVariants.id, variantId));

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    const [brand] = await t.db.select().from(schema.brands);
    const [idea] = await t.db
      .insert(schema.masterIdeas)
      .values({
        brandId: brand?.id ?? "",
        topic: "Rice",
        category: "GRAINS_RICE_PASTA",
        angle: "COMMON_MISTAKE",
        coreMessage: "Do not rinse risotto rice.",
        status: "ACCEPTED",
        origin: "MANUAL",
      })
      .returning();
    const ideaId = idea?.id ?? "";
    const [market] = await t.db
      .select()
      .from(schema.markets)
      .where(eq(schema.markets.code, "es-ES"));
    failOn = () => undefined;
    images = createFakeImageProvider({ fail: (r, n) => failOn(r.label, n) });
    storage = createMemoryStorage();
    ctx = makeCtx();
    const [row] = await t.db
      .insert(schema.contentVariants)
      .values({
        masterIdeaId: ideaId,
        marketId: market?.id ?? "",
        status: "READY_FOR_REVIEW",
        slidesJson: [
          slide("s1", 0, "A", "HOOK"),
          slide("s2", 1, "B", "FACT"),
          slide("s3", 2, "F", "CTA"),
        ],
      })
      .returning();
    variantId = row?.id ?? "";
    await setBrief([
      entry("s1", "hero"),
      entry("s2", "side"),
      entry("s3", "product", { source: "NONE" }),
    ]);
  });

  afterEach(async () => {
    await t.close();
  });

  it("generates, normalizes and stores every picture and points the slides at the assets", async () => {
    const result = await generateVisualAssets(ctx, { variantId });
    expect(result.outcomes.map((o) => `${o.slot}:${o.status}`).sort()).toEqual([
      "hero:GENERATED",
      "product:SKIPPED",
      "side:GENERATED",
    ]);
    expect(result.visualMissing).toBe(false);
    const rows = await assets();
    expect(rows).toHaveLength(2);
    const hero = rows.find((r) => r.slot === "hero");
    expect(hero).toMatchObject({
      kind: "GENERATED",
      status: "READY",
      isAiGenerated: true,
      provider: "fake",
      width: 1080,
      height: 1350,
      mimeType: "image/webp",
    });
    expect(hero?.phash).toMatch(/^[0-9a-f]{16}$/);
    expect(hero?.storageKey).toMatch(/^assets\/.+\/s1-hero-[0-9a-f]{16}\.webp$/);
    expect((await storage.head(hero?.storageKey ?? ""))?.contentType).toBe("image/webp");
    expect(await storage.head(hero?.originalKey ?? "")).not.toBeNull();
    const v = await variant();
    expect(v.slidesJson[0]?.images.hero?.assetId).toBe(hero?.id);
    expect(v.slidesJson[1]?.images.side?.assetId).toBeTruthy();
    expect(v.flags).not.toContain("VISUAL_MISSING");
    expect((await t.db.select().from(schema.auditEvents)).map((a) => a.action)).toContain(
      "variant.visual_assets_generated",
    );
  });

  it("is idempotent: a rerun pays for nothing and creates no duplicates", async () => {
    await generateVisualAssets(ctx, { variantId });
    const calls = images.calls.length;
    const again = await generateVisualAssets(ctx, { variantId });
    expect(images.calls).toHaveLength(calls);
    expect(again.outcomes.filter((o) => o.status === "REUSED")).toHaveLength(2);
    expect(await assets()).toHaveLength(2);
  });

  it("reports a failed slot, flags VISUAL_MISSING, and retries only that slot", async () => {
    failOn = (label) => (label === "s1/hero" ? new Error("provider said no") : undefined);
    const result = await generateVisualAssets(ctx, { variantId });
    expect(result.outcomes.find((o) => o.slot === "hero")).toMatchObject({
      status: "FAILED",
      error: "provider said no",
    });
    expect(result.outcomes.find((o) => o.slot === "side")?.status).toBe("GENERATED");
    expect(result.visualMissing).toBe(true);
    expect((await variant()).flags).toContain("VISUAL_MISSING");
    const failed = (await assets()).find((r) => r.slot === "hero");
    expect(failed).toMatchObject({ status: "FAILED", error: { message: "provider said no" } });

    failOn = () => undefined;
    const before = images.calls.length;
    const retry = await generateVisualAssets(ctx, {
      variantId,
      slots: [{ slideId: "s1", slot: "hero" }],
    });
    expect(images.calls).toHaveLength(before + 1);
    expect(retry.outcomes).toHaveLength(1);
    expect(retry.visualMissing).toBe(false);
    expect((await variant()).flags).not.toContain("VISUAL_MISSING");
    expect(
      (await assets())
        .filter((r) => r.slot === "hero")
        .map((r) => r.status)
        .sort(),
    ).toEqual(["FAILED", "READY"]);
  });

  it("rethrows a provider that is down after finishing the other slots", async () => {
    failOn = (label) => (label === "s1/hero" ? new TransientError("down") : undefined);
    await expect(generateVisualAssets(ctx, { variantId })).rejects.toBeInstanceOf(TransientError);
    expect((await assets()).find((r) => r.slot === "side")?.status).toBe("READY");
    expect((await variant()).flags).toContain("VISUAL_MISSING");
  });

  describe("library photos", () => {
    const makePhoto = async (visuallyTransform: "ALLOWED" | "UNKNOWN" = "ALLOWED") => {
      const [brand] = await t.db.select().from(schema.brands);
      const [source] = await t.db
        .insert(schema.sourceAssets)
        .values({
          brandId: brand?.id ?? "",
          type: "PHOTO",
          title: "Rice",
          originalLanguage: "ru",
          rights: {
            use: "ALLOWED",
            translate: "ALLOWED",
            adapt: "ALLOWED",
            visuallyTransform,
            sell: "UNKNOWN",
            aiProcessing: "DENIED",
            improvePrompts: "DENIED",
          },
        })
        .returning();
      const [asset] = await t.db
        .insert(schema.visualAssets)
        .values({
          brandId: brand?.id ?? "",
          kind: "LIBRARY_PHOTO",
          status: "READY",
          sourceAssetId: source?.id ?? null,
          storageKey: "library/x.webp",
          mimeType: "image/webp",
        })
        .returning();
      return { assetId: asset?.id ?? "", sourceId: source?.id ?? "" };
    };

    it("uses a library photo without calling the provider", async () => {
      const { assetId } = await makePhoto();
      await setBrief([entry("s1", "hero", { source: "LIBRARY", libraryAssetId: assetId })]);
      const result = await generateVisualAssets(ctx, { variantId });
      expect(images.calls).toHaveLength(0);
      expect(result.outcomes[0]).toMatchObject({ status: "LIBRARY", assetId });
      expect((await variant()).slidesJson[0]?.images.hero?.assetId).toBe(assetId);
    });

    it("fails the slot when the rights no longer allow the photo", async () => {
      const { assetId } = await makePhoto("UNKNOWN");
      await setBrief([entry("s1", "hero", { source: "LIBRARY", libraryAssetId: assetId })]);
      const result = await generateVisualAssets(ctx, { variantId });
      expect(result.outcomes[0]).toMatchObject({
        status: "FAILED",
        error: "The library photo is no longer available.",
      });
      expect(result.visualMissing).toBe(true);
    });
  });

  it("flags VISUAL_MISSING when there is no brief, and refuses a variant that is not open", async () => {
    await t.db
      .update(schema.contentVariants)
      .set({ visualBriefJson: null })
      .where(eq(schema.contentVariants.id, variantId));
    const result = await generateVisualAssets(ctx, { variantId });
    expect(result).toMatchObject({ outcomes: [], visualMissing: true });
    expect((await variant()).flags).toContain("VISUAL_MISSING");
    await t.db
      .update(schema.contentVariants)
      .set({ status: "APPROVED" })
      .where(eq(schema.contentVariants.id, variantId));
    await expect(generateVisualAssets(ctx, { variantId })).rejects.toBeInstanceOf(
      InvalidStateError,
    );
  });

  it("makes another asset when the prompt changes", async () => {
    await generateVisualAssets(ctx, { variantId });
    await setBrief([entry("s1", "hero", { prompt: "A different picture" }), entry("s2", "side")]);
    await generateVisualAssets(ctx, { variantId });
    expect((await assets()).filter((r) => r.slot === "hero" && r.status === "READY")).toHaveLength(
      2,
    );
    expect(images.calls).toHaveLength(3);
  });
});
