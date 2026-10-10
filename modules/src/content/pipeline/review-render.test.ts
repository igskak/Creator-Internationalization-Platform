import { schema } from "@rc/db";
import type { Slide } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { createLogger } from "@rc/lib/logging";
import { createMemoryStorage } from "@rc/lib/providers/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, manualClock, type ServiceContext } from "../../core";
import { loadRenderInput } from "../../visuals";
import { getReviewBundle } from "./review";

// The `render` part of the review bundle (M3-13): NONE, RENDERING, READY, STALE, FAILED. Render
// rows are inserted directly; the browser render itself is tested in visuals. Synthetic content.

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
  slide("s1", 0, "A", "HOOK", { headline: "Hola" }),
  slide("s2", 1, "B", "FACT", { body: "Texto." }),
  slide("s3", 2, "F", "CTA", { headline: "Guárdalo", body: "Gracias." }),
];

describe("review bundle: render state", () => {
  let t: TestDb;
  let ctx: ServiceContext;
  let storage: ReturnType<typeof createMemoryStorage>;
  let variantId: string;
  let ideaId: string;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
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
    ideaId = idea?.id ?? "";
    const [market] = await t.db
      .select()
      .from(schema.markets)
      .where(eq(schema.markets.code, "es-ES"));
    const [row] = await t.db
      .insert(schema.contentVariants)
      .values({
        masterIdeaId: ideaId,
        marketId: market?.id ?? "",
        status: "READY_FOR_REVIEW",
        slidesJson: structuredClone(slides),
      })
      .returning();
    variantId = row?.id ?? "";
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

  const render = async () => (await getReviewBundle(ctx, ideaId)).variants[0]?.render;
  const insertRender = async (status: "READY" | "RENDERING" | "FAILED", inputHash?: string) => {
    const hash = inputHash ?? (await loadRenderInput(ctx, variantId)).inputHash;
    const [row] = await t.db
      .insert(schema.carouselRenders)
      .values({
        contentVariantId: variantId,
        inputHash: hash,
        status,
        templatesVersion: "t",
        ...(status === "FAILED" ? { error: { code: "RENDER_FAILED", message: "boom" } } : {}),
      })
      .returning();
    const id = row?.id ?? "";
    if (status === "READY") {
      for (const [i, slide] of slides.entries()) {
        await storage.put(`renders/${variantId}/${id}/${i}.jpg`, "x", {
          contentType: "image/jpeg",
        });
        await t.db.insert(schema.renderedSlides).values({
          carouselRenderId: id,
          slideIndex: i,
          slideId: slide.id,
          templateId: slide.templateId,
          storageKey: `renders/${variantId}/${id}/${i}.jpg`,
          width: 1080,
          height: 1350,
          bytes: 1,
          sha256: "x",
        });
      }
      await t.db
        .update(schema.contentVariants)
        .set({ currentRenderId: id })
        .where(eq(schema.contentVariants.id, variantId));
    }
    return id;
  };

  it("is NONE before any render and RENDERING while one runs", async () => {
    expect(await render()).toMatchObject({ state: "NONE", slides: [] });
    await insertRender("RENDERING");
    expect(await render()).toMatchObject({ state: "RENDERING", slides: [] });
  });

  it("is READY with presigned URLs in slide order when the render matches the content", async () => {
    const id = await insertRender("READY");
    const view = await render();
    expect(view).toMatchObject({ state: "READY", renderId: id });
    expect(view?.slides.map((s) => s.slideId)).toEqual(["s1", "s2", "s3"]);
    expect(view?.slides[0]?.url).toContain(`renders/${variantId}/${id}/0.jpg`);
  });

  it("is STALE after a text edit, until the new render is running", async () => {
    await insertRender("READY");
    const edited = structuredClone((await variant()).slidesJson);
    (edited[1] as Slide).slots.body = "Otro texto.";
    await t.db
      .update(schema.contentVariants)
      .set({ slidesJson: edited })
      .where(eq(schema.contentVariants.id, variantId));
    expect(await render()).toMatchObject({ state: "STALE" });
    await insertRender("RENDERING");
    expect(await render()).toMatchObject({ state: "RENDERING" });
  });

  it("is FAILED with the message when the last render failed and none is current", async () => {
    await insertRender("FAILED");
    expect(await render()).toMatchObject({ state: "FAILED", error: "boom" });
  });
});
