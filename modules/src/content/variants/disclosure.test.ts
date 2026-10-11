import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { InvalidStateError } from "@rc/lib/errors";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadRenderAssets, loadRenderInput } from "../../visuals";
import { getReviewBundle } from "../pipeline";
import { approveVariant, verifyApprovedVersion } from "./approve";
import { type ReviewFixture, reviewFixture } from "./test-support";

// The AI imagery disclosure through review, render and approval (M5-12).

describe("AI imagery disclosure at approval", () => {
  let t: TestDb;
  let fx: ReviewFixture;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    fx = await reviewFixture(t.db);
  });
  afterEach(async () => {
    await t.close();
  });

  const setMode = (mode: "NONE" | "CAPTION_NOTE" | "SLIDE_BADGE" | "PLATFORM_LABEL") =>
    t.db
      .update(schema.markets)
      .set({ aiImageryDisclosure: mode })
      .where(eq(schema.markets.id, fx.marketId));

  /** A draft whose second slide (template B, image slot `side`) carries a generated (or library) image. */
  async function draft(ai: boolean) {
    const made = await fx.makeVariant();
    const [brand] = await t.db.select().from(schema.brands);
    const [asset] = await t.db
      .insert(schema.visualAssets)
      .values({
        brandId: brand?.id ?? "",
        kind: ai ? "GENERATED" : "LIBRARY_PHOTO",
        status: "READY",
        isAiGenerated: ai,
        storageKey: `assets/${made.variantId}.webp`,
        mimeType: "image/webp",
      })
      .returning();
    await fx.storage.put(asset?.storageKey ?? "", "img", { contentType: "image/webp" });
    const v = await fx.variant(made.variantId);
    const slides = v.slidesJson.map((s, i) =>
      i === 1 ? { ...s, images: { side: { assetId: asset?.id ?? "" } } } : s,
    );
    await t.db
      .update(schema.contentVariants)
      .set({ slidesJson: slides })
      .where(eq(schema.contentVariants.id, made.variantId));
    return made.variantId;
  }
  const approve = async (variantId: string) =>
    approveVariant(fx.ctx, {
      variantId,
      lockVersion: (await fx.variant(variantId)).lockVersion,
      checklist: { factsChecked: true },
    });
  const snapshotOf = async (variantId: string) =>
    (
      await t.db
        .select()
        .from(schema.contentVariantVersions)
        .where(eq(schema.contentVariantVersions.contentVariantId, variantId))
    )[0]?.snapshot;

  it("adds nothing when the market says NONE", async () => {
    const variantId = await draft(true);
    await fx.makeRender(variantId);
    await approve(variantId);
    expect((await snapshotOf(variantId))?.disclosure).toBeUndefined();
  });

  it("puts the caption note in the approved snapshot, and the snapshot still verifies", async () => {
    await setMode("CAPTION_NOTE");
    const variantId = await draft(true);
    await fx.makeRender(variantId);
    await approve(variantId);
    expect((await snapshotOf(variantId))?.disclosure).toEqual({
      mode: "CAPTION_NOTE",
      captionNote: "Imágenes generadas con IA.",
    });
    const v = await fx.variant(variantId);
    expect(await verifyApprovedVersion(fx.ctx, v.approvedVersionId ?? "")).toEqual({
      ok: true,
      problems: [],
    });
  });

  it("records the label request, and nothing for a draft without a generated image", async () => {
    await setMode("PLATFORM_LABEL");
    const ai = await draft(true);
    await fx.makeRender(ai);
    await approve(ai);
    expect((await snapshotOf(ai))?.disclosure).toEqual({
      mode: "PLATFORM_LABEL",
      platformLabel: true,
    });
    const library = await draft(false);
    await fx.makeRender(library);
    await approve(library);
    expect((await snapshotOf(library))?.disclosure).toBeUndefined();
  });

  it("shows the reviewer what will be added before approving", async () => {
    await setMode("CAPTION_NOTE");
    const variantId = await draft(true);
    const bundle = await getReviewBundle(fx.ctx, (await fx.variant(variantId)).masterIdeaId);
    expect(bundle.variants.find((v) => v.id === variantId)?.disclosure).toEqual({
      mode: "CAPTION_NOTE",
      captionNote: "Imágenes generadas con IA.",
    });
    await setMode("NONE");
    const again = await getReviewBundle(fx.ctx, (await fx.variant(variantId)).masterIdeaId);
    expect(again.variants.find((v) => v.id === variantId)?.disclosure).toBeNull();
  });

  describe("the slide badge is part of the render", () => {
    it("changes the render hash only for a draft with a generated image, and marks only its slides", async () => {
      const ai = await draft(true);
      const library = await draft(false);
      const before = {
        ai: (await loadRenderInput(fx.ctx, ai)).inputHash,
        library: (await loadRenderInput(fx.ctx, library)).inputHash,
      };
      await setMode("SLIDE_BADGE");
      const input = await loadRenderInput(fx.ctx, ai);
      expect(input.inputHash).not.toBe(before.ai);
      expect([...input.aiBadgeSlides]).toEqual([input.slides[1]?.id]);
      expect((await loadRenderInput(fx.ctx, library)).inputHash).toBe(before.library);
      const assets = await loadRenderAssets(fx.ctx, input);
      expect(assets.map((a) => a.assets.aiBadge === true)).toEqual(
        input.slides.map((_, i) => i === 1),
      );
    });

    it("makes an approval wait for a new render when the setting changed after the render", async () => {
      const variantId = await draft(true);
      await fx.makeRender(variantId);
      await setMode("SLIDE_BADGE");
      await expect(approve(variantId)).rejects.toBeInstanceOf(InvalidStateError);
      await fx.makeRender(variantId);
      await approve(variantId);
      expect((await snapshotOf(variantId))?.disclosure).toEqual({
        mode: "SLIDE_BADGE",
        badge: true,
      });
    });
  });
});
