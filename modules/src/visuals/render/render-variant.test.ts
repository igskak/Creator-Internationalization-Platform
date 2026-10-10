import { schema } from "@rc/db";
import type { Slide, VisualBrief } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { createLogger } from "@rc/lib/logging";
import { createFakeImageProvider } from "@rc/lib/providers/image";
import { createMemoryStorage } from "@rc/lib/providers/storage";
import type { Browser } from "playwright-core";
import sharp from "sharp";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, type JobRunner, manualClock, type ServiceContext } from "../../core";
import { generateVisualAssets } from "../generate-assets";
import { loadRenderInput, requestRender } from "../render-input";
import { renderVariantCarousel } from "./render-variant";
import { launchBrowser } from "./renderer";

// J8 end to end with fakes: slides and a brief in the database, pictures by the fake provider
// (J7), a real Chromium render. Without a browser the render tests are skipped. Synthetic content.

const browser: Browser | undefined = await launchBrowser().catch(() => undefined);
afterAll(async () => {
  await browser?.close();
});

const slide = (
  id: string,
  index: number,
  templateId: string,
  role: string,
  slots: Record<string, string>,
): Slide => ({
  id,
  index,
  role: role as Slide["role"],
  templateId: templateId as Slide["templateId"],
  slots,
  images: {},
  knowledgeIds: [],
  factual: false,
});
const slides = [
  slide("s1", 0, "A", "HOOK", { headline: "¿Por qué no lavar el arroz?", kicker: "Mito" }),
  slide("s2", 1, "B", "FACT", { number: "2:1", body: "Dos partes de agua por una de arroz." }),
  slide("s3", 2, "F", "CTA", { headline: "Guárdalo", body: "Te servirá la próxima vez." }),
];
const brief: VisualBrief = {
  concept: "c",
  visualStyle: "WARM_RUSTIC",
  differentiationFromSibling: "",
  slides: [
    {
      slideId: "s1",
      slot: "hero",
      source: "GENERATE",
      prompt: "Rice",
      composition: "x",
      aspect: "4:5",
    },
  ],
};

describe("render-carousel (J8)", () => {
  let t: TestDb;
  let ctx: ServiceContext;
  let storage: ReturnType<typeof createMemoryStorage>;
  let variantId: string;
  let triggered: { name: string; payload: unknown; key?: string; delay?: number }[];

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    triggered = [];
    const jobs: JobRunner = {
      trigger: async (name, payload, options) => {
        triggered.push({
          name,
          payload,
          ...(options?.idempotencyKey ? { key: options.idempotencyKey } : {}),
          ...(options?.delaySeconds ? { delay: options.delaySeconds } : {}),
        });
        return { runId: "run-1" };
      },
    } as JobRunner;
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
      images: createFakeImageProvider(),
      storage,
      jobs,
      actor: { type: "SYSTEM" },
    });
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
    const [market] = await t.db
      .select()
      .from(schema.markets)
      .where(eq(schema.markets.code, "es-ES"));
    const [row] = await t.db
      .insert(schema.contentVariants)
      .values({
        masterIdeaId: idea?.id ?? "",
        marketId: market?.id ?? "",
        status: "READY_FOR_REVIEW",
        slidesJson: structuredClone(slides),
        visualBriefJson: brief,
      })
      .returning();
    variantId = row?.id ?? "";
    await generateVisualAssets(ctx, { variantId });
  });

  afterEach(async () => {
    await t.close();
  });

  const variant = async () => {
    const [v] = await t.db
      .select()
      .from(schema.contentVariants)
      .where(eq(schema.contentVariants.id, variantId));
    return v as typeof schema.contentVariants.$inferSelect;
  };

  describe("input hash and queueing (no browser)", () => {
    it("changes with the text, the picture and the theme variant, not with the status", async () => {
      const first = (await loadRenderInput(ctx, variantId)).inputHash;
      expect((await loadRenderInput(ctx, variantId)).inputHash).toBe(first);
      const edited = structuredClone((await variant()).slidesJson);
      (edited[1] as Slide).slots.body = "Otro texto.";
      await t.db
        .update(schema.contentVariants)
        .set({ slidesJson: edited })
        .where(eq(schema.contentVariants.id, variantId));
      const second = (await loadRenderInput(ctx, variantId)).inputHash;
      expect(second).not.toBe(first);
      (edited[0] as Slide).images = {};
      await t.db
        .update(schema.contentVariants)
        .set({ slidesJson: edited })
        .where(eq(schema.contentVariants.id, variantId));
      expect((await loadRenderInput(ctx, variantId)).inputHash).not.toBe(second);
    });

    it("queues one job per distinct content, with a delay for edits", async () => {
      const a = await requestRender(ctx, variantId, { delaySeconds: 10 });
      await requestRender(ctx, variantId);
      expect(triggered[0]).toMatchObject({
        name: "render-carousel",
        payload: { variantId },
        key: `render:${variantId}:${a.inputHash}`,
        delay: 10,
      });
      expect(triggered[1]?.key).toBe(triggered[0]?.key);
    });
  });

  describe.skipIf(!browser)("rendering", () => {
    const render = () => renderVariantCarousel(ctx, { variantId }, { browser: browser as Browser });

    it("renders the slides, stores JPEGs and the QA report, and makes the render current", async () => {
      const result = await render();
      expect(result).toMatchObject({ status: "READY", reused: false, problems: [] });
      const [row] = await t.db
        .select()
        .from(schema.carouselRenders)
        .where(eq(schema.carouselRenders.id, result.renderId));
      expect(row).toMatchObject({
        status: "READY",
        slideCount: 3,
        width: 1080,
        height: 1350,
        templatesVersion: "A@1.0.0,B@1.0.0,F@1.0.0",
        qaReport: { dimensionsOk: true, logoPlacementOk: true, overflow: [] },
      });
      const files = await t.db
        .select()
        .from(schema.renderedSlides)
        .where(eq(schema.renderedSlides.carouselRenderId, result.renderId));
      expect(files.map((f) => f.slideIndex).sort()).toEqual([0, 1, 2]);
      const jpeg = await storage.getBytes(files[0]?.storageKey ?? "");
      expect(await sharp(jpeg).metadata()).toMatchObject({
        format: "jpeg",
        width: 1080,
        height: 1350,
      });
      const v = await variant();
      expect(v.currentRenderId).toBe(result.renderId);
      expect(v.flags).not.toContain("TEXT_OVERFLOW");
      expect((await t.db.select().from(schema.auditEvents)).map((a) => a.action)).toContain(
        "variant.rendered",
      );
    }, 120_000);

    it("reuses a READY render of the same input", async () => {
      const first = await render();
      const second = await render();
      expect(second).toMatchObject({ reused: true, renderId: first.renderId });
      expect(await t.db.select().from(schema.carouselRenders)).toHaveLength(1);
    }, 120_000);

    it("flags an overflow, and clears the flag after the text is fixed", async () => {
      const bad = structuredClone((await variant()).slidesJson);
      (bad[0] as Slide).slots.headline = "X".repeat(400);
      await t.db
        .update(schema.contentVariants)
        .set({ slidesJson: bad })
        .where(eq(schema.contentVariants.id, variantId));
      const result = await render();
      expect(result.flags).toEqual(["TEXT_OVERFLOW"]);
      expect((await variant()).flags).toContain("TEXT_OVERFLOW");

      const good = structuredClone(bad);
      (good[0] as Slide).slots.headline = "Texto corto";
      await t.db
        .update(schema.contentVariants)
        .set({ slidesJson: good })
        .where(eq(schema.contentVariants.id, variantId));
      const fixed = await render();
      expect(fixed.flags).toEqual([]);
      const v = await variant();
      expect(v.flags).not.toContain("TEXT_OVERFLOW");
      expect(v.currentRenderId).toBe(fixed.renderId);
    }, 120_000);

    it("fails a render with a missing glyph without a picture, and flags it", async () => {
      const bad = structuredClone((await variant()).slidesJson);
      (bad[1] as Slide).slots.body = "Caliente 🔥";
      await t.db
        .update(schema.contentVariants)
        .set({ slidesJson: bad })
        .where(eq(schema.contentVariants.id, variantId));
      const result = await render();
      expect(result).toMatchObject({ status: "FAILED", flags: ["MISSING_GLYPH"] });
      const [row] = await t.db
        .select()
        .from(schema.carouselRenders)
        .where(eq(schema.carouselRenders.id, result.renderId));
      expect(row).toMatchObject({
        status: "FAILED",
        error: { code: "MISSING_GLYPH" },
        qaReport: { missingGlyphs: [{ slideId: "s2", slot: "body", chars: ["🔥"] }] },
      });
      expect(await t.db.select().from(schema.renderedSlides)).toEqual([]);
      expect((await variant()).flags).toContain("MISSING_GLYPH");
    }, 60_000);

    it("flags VISUAL_MISSING when a required picture is absent", async () => {
      const noPicture = structuredClone((await variant()).slidesJson);
      (noPicture[0] as Slide).images = {};
      await t.db
        .update(schema.contentVariants)
        .set({ slidesJson: noPicture })
        .where(eq(schema.contentVariants.id, variantId));
      const result = await render();
      expect(result.flags).toContain("VISUAL_MISSING");
    }, 120_000);
  });
});
