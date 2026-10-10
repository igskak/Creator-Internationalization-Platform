import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QaReport } from "../json";
import { createTestDb, type TestDb } from "../test-db";
import { carouselRenders, contentVariants, masterIdeas } from "./content";
import { brands, markets } from "./core";
import { renderedSlides, visualAssets } from "./creative";

// Synthetic data only.
describe("0004_creative", () => {
  let t: TestDb;
  let brandId: string;
  let variantId: string;

  const newRender = async (inputHash: string) => {
    const [render] = await t.db
      .insert(carouselRenders)
      .values({ contentVariantId: variantId, inputHash, templatesVersion: "t1" })
      .returning();
    return render?.id ?? "";
  };

  beforeAll(async () => {
    t = await createTestDb();
    const [brand] = await t.db.insert(brands).values({ slug: "cr-brand", name: "C" }).returning();
    brandId = brand?.id ?? "";
    const [market] = await t.db
      .insert(markets)
      .values({
        brandId,
        code: "es-ES",
        displayName: "Spain",
        country: "ES",
        language: "es",
        timezone: "Europe/Madrid",
        currency: "EUR",
        measurementSystem: "METRIC",
      })
      .returning();
    const [idea] = await t.db
      .insert(masterIdeas)
      .values({
        brandId,
        topic: "Idea",
        category: "GRAINS_RICE_PASTA",
        angle: "COMMON_MISTAKE",
        coreMessage: "Synthetic core message",
        origin: "MANUAL",
      })
      .returning();
    const [variant] = await t.db
      .insert(contentVariants)
      .values({ masterIdeaId: idea?.id ?? "", marketId: market?.id ?? "" })
      .returning();
    variantId = variant?.id ?? "";
  });

  afterAll(async () => {
    await t.close();
  });

  it("enables RLS on every creative table", async () => {
    const names = ["visual_assets", "carousel_renders", "rendered_slides"];
    const result = await t.db.execute<{ relrowsecurity: boolean }>(sql`
      select relrowsecurity from pg_class
      where relname in (${sql.join(
        names.map((n) => sql`${n}`),
        sql`, `,
      )})`);
    expect(result.rows).toHaveLength(names.length);
    expect(result.rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it("applies the defaults of an asset and keeps its updated_at current", async () => {
    const [asset] = await t.db
      .insert(visualAssets)
      .values({ brandId, kind: "GENERATED", contentVariantId: variantId })
      .returning();
    expect(asset).toMatchObject({
      status: "PENDING",
      isAiGenerated: false,
      tags: [],
      rights: null,
    });
    await new Promise((r) => setTimeout(r, 20));
    const [updated] = await t.db
      .update(visualAssets)
      .set({ status: "READY", storageKey: "k/1.webp" })
      .where(eq(visualAssets.id, asset?.id ?? ""))
      .returning();
    expect((updated?.updatedAt.getTime() ?? 0) > (asset?.updatedAt.getTime() ?? 0)).toBe(true);
  });

  it("rejects an unknown asset kind", async () => {
    await expect(
      t.db
        .insert(visualAssets)
        .values({ brandId, kind: "STOCK" as "GENERATED", contentVariantId: variantId }),
    ).rejects.toThrow();
  });

  it("allows one live generated asset per slot and prompt, and a new one after a failure", async () => {
    const base = {
      brandId,
      kind: "GENERATED" as const,
      contentVariantId: variantId,
      slideId: "s1",
      slot: "background",
      promptHash: "h1",
    };
    const [first] = await t.db.insert(visualAssets).values(base).returning();
    await expect(t.db.insert(visualAssets).values(base)).rejects.toThrow();
    // Another prompt for the same slot is a different generation.
    await t.db.insert(visualAssets).values({ ...base, promptHash: "h2" });
    // A failed one no longer counts: the retry may create a new row.
    await t.db
      .update(visualAssets)
      .set({ status: "FAILED" })
      .where(eq(visualAssets.id, first?.id ?? ""));
    await t.db.insert(visualAssets).values(base);
    // The guard does not apply to library photos.
    const photo = { ...base, kind: "LIBRARY_PHOTO" as const };
    await t.db.insert(visualAssets).values(photo);
    await t.db.insert(visualAssets).values(photo);
  });

  it("makes (variant, input hash) unique and stores a QA report", async () => {
    const qa: QaReport = {
      overflow: [{ slideId: "s1", slot: "headline", fontPxUsed: 56 }],
      missingGlyphs: [],
      dimensionsOk: true,
      logoPlacementOk: true,
      fileSizes: [210_000],
      durationMs: 1800,
    };
    expect(QaReport.parse(qa)).toEqual(qa);
    const id = await newRender("hash-a");
    const [render] = await t.db
      .update(carouselRenders)
      .set({ status: "READY", qaReport: qa, slideCount: 1 })
      .where(eq(carouselRenders.id, id))
      .returning();
    expect(render).toMatchObject({ width: 1080, height: 1350, qaReport: qa });
    await expect(newRender("hash-a")).rejects.toThrow();
    await newRender("hash-b");
  });

  it("keeps rendered slides unique per index and deletes them with their render", async () => {
    const renderId = await newRender("hash-slides");
    const slide = {
      carouselRenderId: renderId,
      slideIndex: 0,
      slideId: "s1",
      templateId: "A",
      storageKey: "renders/r/0.jpg",
      width: 1080,
      height: 1350,
      bytes: 200_000,
      sha256: "abc",
    };
    await t.db.insert(renderedSlides).values(slide);
    await expect(t.db.insert(renderedSlides).values(slide)).rejects.toThrow();
    await t.db.delete(carouselRenders).where(eq(carouselRenders.id, renderId));
    expect(
      await t.db.select().from(renderedSlides).where(eq(renderedSlides.carouselRenderId, renderId)),
    ).toEqual([]);
  });

  it("points a variant at its current render", async () => {
    const renderId = await newRender("hash-current");
    const [variant] = await t.db
      .update(contentVariants)
      .set({ currentRenderId: renderId })
      .where(eq(contentVariants.id, variantId))
      .returning();
    expect(variant?.currentRenderId).toBe(renderId);
    await expect(
      t.db
        .update(contentVariants)
        .set({ currentRenderId: "00000000-0000-4000-8000-000000000000" })
        .where(eq(contentVariants.id, variantId)),
    ).rejects.toThrow();
  });
});
