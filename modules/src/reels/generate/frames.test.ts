import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { TransientError } from "@rc/lib/errors";
import { createFakeImageProvider } from "@rc/lib/providers/image";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearPendingReelFrames,
  ensureReelFrame,
  REEL_FRAME_STYLE,
  reelFrameHash,
  reelFramePrompt,
} from "./frames";
import { type ReelFixture, reelFixture } from "./test-support";

// The pictures made for a Reel's shots (reel-director@4). Fake image model, synthetic content.

describe("reelFramePrompt", () => {
  it("adds the account's look and the dark-cookware rule to the director's description", () => {
    const prompt = reelFramePrompt("  A black cast-iron pot of rice in cloudy water. ");
    expect(prompt.startsWith("A black cast-iron pot of rice in cloudy water. ")).toBe(true);
    expect(prompt).toContain("pure white seamless background");
    expect(prompt).toContain("Pale or white food sits in dark cookware");
    expect(prompt).toContain("top 40% is clean empty white");
    expect(REEL_FRAME_STYLE).toContain("No people, no hands, no text");
  });

  it("hashes the same description and model to the same frame", () => {
    const a = reelFrameHash(reelFramePrompt("A pot."), "m");
    expect(reelFrameHash(reelFramePrompt("A pot."), "m")).toBe(a);
    expect(reelFrameHash(reelFramePrompt("A pan."), "m")).not.toBe(a);
    expect(reelFrameHash(reelFramePrompt("A pot."), "other")).not.toBe(a);
  });
});

describe("ensureReelFrame", () => {
  let t: TestDb;
  let fx: ReelFixture;
  let brandId: string;
  const variants: string[] = [];
  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    fx = await reelFixture(t.db);
    const [carousel] = await t.db
      .select()
      .from(schema.contentVariants)
      .where(eq(schema.contentVariants.id, fx.carouselId));
    const [brand] = await t.db.select().from(schema.brands);
    brandId = brand?.id ?? "";
    variants.length = 0;
    // Two Reel variants of the brand (as for two markets of one idea).
    for (const status of ["DRAFT", "REJECTED"] as const) {
      const [reel] = await t.db
        .insert(schema.contentVariants)
        .values({
          masterIdeaId: carousel?.masterIdeaId ?? "",
          marketId: carousel?.marketId ?? "",
          format: "REEL",
          status,
          sourceVariantId: fx.carouselId,
        })
        .returning();
      variants.push(reel?.id ?? "");
    }
  });
  afterEach(async () => {
    await t.close();
  });

  const scene = { id: "s1", framePrompt: "A black cast-iron pot of rice in cloudy water." };

  it("makes the picture once and reuses it for any Reel of the brand", async () => {
    const images = createFakeImageProvider();
    const first = await ensureReelFrame(
      fx.jobCtx({ images }),
      { brandId, variantId: variants[0] ?? "" },
      scene,
    );
    expect(first).toMatchObject({ reused: false });
    expect(images.calls).toHaveLength(1);
    expect(images.calls[0]).toMatchObject({ aspect: "3:4", label: "reel-frame/s1" });
    const [asset] = await t.db
      .select()
      .from(schema.visualAssets)
      .where(eq(schema.visualAssets.id, first?.assetId ?? ""));
    expect(asset).toMatchObject({
      status: "READY",
      kind: "GENERATED",
      slot: "reel-frame",
      slideId: "s1",
      isAiGenerated: true,
      mimeType: "image/png",
    });
    expect(asset?.storageKey).toMatch(/^reels\/frames\/.+\.png$/);

    const second = await ensureReelFrame(
      fx.jobCtx({ images }),
      { brandId, variantId: variants[1] ?? "" },
      scene,
    );
    expect(second).toMatchObject({ assetId: first?.assetId, reused: true, costUsd: null });
    expect(second?.bytes).toEqual(first?.bytes);
    expect(images.calls).toHaveLength(1);
  });

  it("returns null for a refused picture and throws a passing failure for the retry", async () => {
    const refused = createFakeImageProvider({ fail: () => new Error("refused") });
    expect(
      await ensureReelFrame(
        fx.jobCtx({ images: refused }),
        { brandId, variantId: variants[0] ?? "" },
        scene,
      ),
    ).toBeNull();
    const down = createFakeImageProvider({ fail: () => new TransientError("busy") });
    await expect(
      ensureReelFrame(
        fx.jobCtx({ images: down }),
        { brandId, variantId: variants[0] ?? "" },
        { ...scene, id: "s2" },
      ),
    ).rejects.toBeInstanceOf(TransientError);
  });

  it("frees a frame a crashed run left PENDING, so the next run can make it", async () => {
    await t.db.insert(schema.visualAssets).values({
      brandId,
      kind: "GENERATED",
      status: "PENDING",
      contentVariantId: variants[0] ?? "",
      slideId: "s1",
      slot: "reel-frame",
      promptHash: reelFrameHash(reelFramePrompt(scene.framePrompt), "fake-image"),
      isAiGenerated: true,
    });
    const images = createFakeImageProvider();
    await expect(
      ensureReelFrame(fx.jobCtx({ images }), { brandId, variantId: variants[0] ?? "" }, scene),
    ).rejects.toBeInstanceOf(TransientError);
    await clearPendingReelFrames(fx.jobCtx(), variants[0] ?? "", ["s1"]);
    const made = await ensureReelFrame(
      fx.jobCtx({ images }),
      { brandId, variantId: variants[0] ?? "" },
      scene,
    );
    expect(made).toMatchObject({ reused: false });
  });
});
