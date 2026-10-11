import { schema } from "@rc/db";
import type { Slide } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { createLogger } from "@rc/lib/logging";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, type ServiceContext } from "../core";
import { disclosureNote, planDisclosure, slidesWithGeneratedImages } from "./disclosure";

// The AI imagery disclosure plan of a draft (M5-12, V-16).

describe("AI imagery disclosure", () => {
  let t: TestDb;
  let ctx: ServiceContext;
  let es: string;
  let en: string;
  let aiAsset: string;
  let libraryAsset: string;

  const slide = (id: string, assetId?: string): Slide => ({
    id,
    index: 0,
    role: "FACT",
    templateId: "B",
    slots: {},
    images: assetId ? { photo: { assetId } } : {},
    knowledgeIds: [],
    factual: false,
  });
  const setMode = (
    marketId: string,
    mode: "NONE" | "CAPTION_NOTE" | "SLIDE_BADGE" | "PLATFORM_LABEL",
  ) =>
    t.db
      .update(schema.markets)
      .set({ aiImageryDisclosure: mode })
      .where(eq(schema.markets.id, marketId));

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    ctx = createServiceContext({
      db: t.db,
      logger: createLogger({
        service: "jobs",
        env: "test",
        level: "fatal",
        destination: { write: () => {} },
      }),
      actor: { type: "SYSTEM" },
    });
    const markets = await t.db.select().from(schema.markets);
    es = markets.find((m) => m.code === "es-ES")?.id ?? "";
    en = markets.find((m) => m.code === "en")?.id ?? "";
    const [brand] = await t.db.select().from(schema.brands);
    const make = async (isAiGenerated: boolean) =>
      (
        await t.db
          .insert(schema.visualAssets)
          .values({
            brandId: brand?.id ?? "",
            kind: isAiGenerated ? "GENERATED" : "LIBRARY_PHOTO",
            status: "READY",
            isAiGenerated,
          })
          .returning({ id: schema.visualAssets.id })
      )[0]?.id ?? "";
    aiAsset = await make(true);
    libraryAsset = await make(false);
  });
  afterEach(async () => {
    await t.close();
  });

  it("is off by default, so nothing is added", async () => {
    expect(
      await planDisclosure(ctx, { marketId: es, slides: [slide("s1", aiAsset)] }),
    ).toBeUndefined();
  });

  it("finds the slides that carry a generated image, not library photos or text slides", async () => {
    const slides = [slide("s1", aiAsset), slide("s2", libraryAsset), slide("s3")];
    expect([...(await slidesWithGeneratedImages(ctx, slides))]).toEqual(["s1"]);
  });

  it("adds a caption note in the market's language", async () => {
    await setMode(es, "CAPTION_NOTE");
    await setMode(en, "CAPTION_NOTE");
    expect(await planDisclosure(ctx, { marketId: es, slides: [slide("s1", aiAsset)] })).toEqual({
      mode: "CAPTION_NOTE",
      captionNote: "Imágenes generadas con IA.",
    });
    expect(await planDisclosure(ctx, { marketId: en, slides: [slide("s1", aiAsset)] })).toEqual({
      mode: "CAPTION_NOTE",
      captionNote: "Images created with AI.",
    });
  });

  it("asks for a badge, or for Instagram's label", async () => {
    await setMode(es, "SLIDE_BADGE");
    expect(await planDisclosure(ctx, { marketId: es, slides: [slide("s1", aiAsset)] })).toEqual({
      mode: "SLIDE_BADGE",
      badge: true,
    });
    await setMode(es, "PLATFORM_LABEL");
    expect(await planDisclosure(ctx, { marketId: es, slides: [slide("s1", aiAsset)] })).toEqual({
      mode: "PLATFORM_LABEL",
      platformLabel: true,
    });
  });

  it("adds nothing to a post without a generated image, whatever the setting", async () => {
    for (const mode of ["CAPTION_NOTE", "SLIDE_BADGE", "PLATFORM_LABEL"] as const) {
      await setMode(es, mode);
      expect(
        await planDisclosure(ctx, {
          marketId: es,
          slides: [slide("s1", libraryAsset), slide("s2")],
        }),
      ).toBeUndefined();
    }
  });

  it("falls back to English for a language without a note", () => {
    expect(disclosureNote("fr")).toBe("Images created with AI.");
    expect(disclosureNote("ru")).toMatch(/ИИ/);
  });

  it("refuses a value the database does not know", async () => {
    await expect(setMode(es, "SHOUT" as "NONE")).rejects.toThrow();
  });
});
