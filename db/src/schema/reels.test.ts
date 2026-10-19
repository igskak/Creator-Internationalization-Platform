import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cardWords, ReelHookOption, ReelQaReport, ReelScene } from "../json";
import { createTestDb, type TestDb } from "../test-db";
import { contentVariants, masterIdeas, reelRenders, reelScripts } from "./content";
import { brands, markets } from "./core";
import { reelShots } from "./reels";

// Synthetic data only.
describe("0009_reels", () => {
  let t: TestDb;
  let brandId: string;
  let carouselId: string;
  let reelId: string;
  let ideaId: string;
  let marketId: string;

  const newScript = async (version: number) => {
    const [script] = await t.db
      .insert(reelScripts)
      .values({ contentVariantId: reelId, version, shotModel: "alibaba/wan-3.0" })
      .returning();
    return script?.id ?? "";
  };
  const shot = (promptHash: string, over: Partial<typeof reelShots.$inferInsert> = {}) => ({
    brandId,
    contentVariantId: reelId,
    promptHash,
    provider: "higgsfield",
    model: "alibaba/wan-3.0",
    prompt: "Static camera. Broth pours.",
    durationSeconds: 3,
    ...over,
  });

  beforeAll(async () => {
    t = await createTestDb();
    const [brand] = await t.db.insert(brands).values({ slug: "reel-brand", name: "R" }).returning();
    brandId = brand?.id ?? "";
    const [market] = await t.db
      .insert(markets)
      .values({
        brandId,
        code: "en",
        displayName: "English",
        country: "US",
        language: "en",
        timezone: "America/New_York",
        currency: "USD",
        measurementSystem: "IMPERIAL",
      })
      .returning();
    marketId = market?.id ?? "";
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
    ideaId = idea?.id ?? "";
    const [carousel] = await t.db
      .insert(contentVariants)
      .values({ masterIdeaId: ideaId, marketId })
      .returning();
    carouselId = carousel?.id ?? "";
    const [reel] = await t.db
      .insert(contentVariants)
      .values({ masterIdeaId: ideaId, marketId, format: "REEL", sourceVariantId: carouselId })
      .returning();
    reelId = reel?.id ?? "";
  });

  afterAll(async () => {
    await t.close();
  });

  it("enables RLS on every Reel table", async () => {
    const names = ["reel_scripts", "reel_shots", "reel_renders"];
    const result = await t.db.execute<{ relrowsecurity: boolean }>(sql`
      select relrowsecurity from pg_class
      where relname in (${sql.join(
        names.map((n) => sql`${n}`),
        sql`, `,
      )})`);
    expect(result.rows).toHaveLength(names.length);
    expect(result.rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it("lets one idea and market have a carousel and a Reel, but only one live Reel", async () => {
    expect(carouselId).not.toBe(reelId);
    await expect(
      t.db
        .insert(contentVariants)
        .values({ masterIdeaId: ideaId, marketId, format: "REEL", sourceVariantId: carouselId }),
    ).rejects.toThrow();
    // a rejected Reel no longer counts
    await t.db
      .update(contentVariants)
      .set({ status: "REJECTED" })
      .where(eq(contentVariants.id, reelId));
    const [again] = await t.db
      .insert(contentVariants)
      .values({ masterIdeaId: ideaId, marketId, format: "REEL", sourceVariantId: carouselId })
      .returning();
    reelId = again?.id ?? "";
  });

  it("allows a source variant only on a Reel", async () => {
    const [other] = await t.db
      .insert(masterIdeas)
      .values({
        brandId,
        topic: "Other",
        category: "GRAINS_RICE_PASTA",
        angle: "COMMON_MISTAKE",
        coreMessage: "Another synthetic message",
        origin: "MANUAL",
      })
      .returning();
    await expect(
      t.db.insert(contentVariants).values({
        masterIdeaId: other?.id ?? "",
        marketId,
        format: "CAROUSEL",
        sourceVariantId: carouselId,
      }),
    ).rejects.toThrow();
  });

  it("versions a script per variant and applies its defaults", async () => {
    const first = await newScript(1);
    await newScript(2);
    await expect(newScript(2)).rejects.toThrow();
    await expect(newScript(0)).rejects.toThrow();
    const [script] = await t.db.select().from(reelScripts).where(eq(reelScripts.id, first));
    expect(script).toMatchObject({ hookOptions: [], scenes: [], flashOpener: "ON" });
  });

  it("makes (variant, input hash) unique for renders and requires a file when READY", async () => {
    const scriptId = await newScript(10);
    const render = (inputHash: string) =>
      t.db
        .insert(reelRenders)
        .values({
          contentVariantId: reelId,
          reelScriptId: scriptId,
          inputHash,
          rendererVersion: "r1",
        })
        .returning();
    const [first] = await render("h1");
    expect(first).toMatchObject({
      width: 1080,
      height: 1920,
      status: "PENDING",
      audioKind: "NONE",
    });
    await expect(render("h1")).rejects.toThrow();
    await expect(
      t.db
        .update(reelRenders)
        .set({ status: "READY" })
        .where(eq(reelRenders.id, first?.id ?? "")),
    ).rejects.toThrow();
    const qa: ReelQaReport = {
      durationMs: 14500,
      width: 1080,
      height: 1920,
      videoCodec: "h264",
      audioCodec: "aac",
      fileBytes: 9_000_000,
      blackFrames: 0,
      safeZoneOk: true,
      firstSecondMotion: 12.5,
      warnings: [],
    };
    expect(ReelQaReport.parse(qa)).toEqual(qa);
    const [ready] = await t.db
      .update(reelRenders)
      .set({
        status: "READY",
        storageKey: "reels/1.mp4",
        qaReport: qa,
        audioKind: "PLACEHOLDER_BEAT",
      })
      .where(eq(reelRenders.id, first?.id ?? ""))
      .returning();
    expect(ready).toMatchObject({ status: "READY", qaReport: qa });
    // 0016: the model's own sound (reel-director@4).
    const [withModelAudio] = await t.db
      .update(reelRenders)
      .set({ audioKind: "MODEL_AUDIO" })
      .where(eq(reelRenders.id, first?.id ?? ""))
      .returning();
    expect(withModelAudio?.audioKind).toBe("MODEL_AUDIO");
    await expect(
      t.db
        .update(reelRenders)
        .set({ audioKind: "RADIO" as "NONE" })
        .where(eq(reelRenders.id, first?.id ?? "")),
    ).rejects.toThrow();
  });

  it("points a variant at its current Reel render", async () => {
    const scriptId = await newScript(20);
    const [render] = await t.db
      .insert(reelRenders)
      .values({
        contentVariantId: reelId,
        reelScriptId: scriptId,
        inputHash: "cur",
        rendererVersion: "r1",
      })
      .returning();
    const [variant] = await t.db
      .update(contentVariants)
      .set({ currentReelRenderId: render?.id ?? "" })
      .where(eq(contentVariants.id, reelId))
      .returning();
    expect(variant?.currentReelRenderId).toBe(render?.id);
  });

  it("keeps one live shot per brand and prompt hash, so another market finds it", async () => {
    const [first] = await t.db.insert(reelShots).values(shot("p1")).returning();
    expect(first).toMatchObject({ status: "PENDING", resolution: "720p" });
    // another variant of the same brand asking for the same shot hits the guard (it must reuse)
    await expect(
      t.db.insert(reelShots).values(shot("p1", { contentVariantId: carouselId })),
    ).rejects.toThrow();
    await t.db.insert(reelShots).values(shot("p2"));
    // a failed or blocked shot no longer counts: a retry may create a new row
    await t.db
      .update(reelShots)
      .set({ status: "FAILED" })
      .where(eq(reelShots.id, first?.id ?? ""));
    await t.db.insert(reelShots).values(shot("p1"));
  });

  it("checks the shot's status against its file and request id", async () => {
    await expect(t.db.insert(reelShots).values(shot("r1", { status: "READY" }))).rejects.toThrow();
    await expect(
      t.db.insert(reelShots).values(shot("r2", { status: "RUNNING" })),
    ).rejects.toThrow();
    await t.db
      .insert(reelShots)
      .values(shot("r3", { status: "RUNNING", providerRequestId: "req-1" }));
    await t.db
      .insert(reelShots)
      .values(shot("r4", { status: "READY", storageKey: "reels/shots/r4.mp4" }));
    await expect(
      t.db.insert(reelShots).values(shot("r5", { durationSeconds: 0 })),
    ).rejects.toThrow();
    await expect(
      t.db.insert(reelShots).values(shot("r6", { durationSeconds: 31 })),
    ).rejects.toThrow();
  });

  it("keeps a shot's updated_at current", async () => {
    const [created] = await t.db.insert(reelShots).values(shot("u1")).returning();
    await new Promise((r) => setTimeout(r, 20));
    const [updated] = await t.db
      .update(reelShots)
      .set({ status: "RUNNING", providerRequestId: "req-u" })
      .where(eq(reelShots.id, created?.id ?? ""))
      .returning();
    expect((updated?.updatedAt.getTime() ?? 0) > (created?.updatedAt.getTime() ?? 0)).toBe(true);
  });

  it("accepts the new generation stages", async () => {
    const result = await t.db.execute<{ enumlabel: string }>(sql`
      select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'generation_stage'`);
    const labels = result.rows.map((r) => r.enumlabel);
    expect(labels).toEqual(expect.arrayContaining(["REEL_DIRECTION", "REEL_SHOT"]));
  });
});

describe("Reel JSON shapes", () => {
  const scene = {
    id: "sc1",
    index: 0,
    role: "HOOK",
    emotion: "DOUBT",
    beats: 3.5,
    card: "Hot water on **bulgur?**",
    shotPrompt: "Static camera. Broth pours into the pot. No text, no people.",
    sourcePictureId: "asset-1",
    layout: "RIGHT",
    claimSlideIds: ["s1"],
  };

  it("counts card words without the accent marks", () => {
    expect(cardWords("Hot water on **bulgur?**")).toEqual(["Hot", "water", "on", "bulgur?"]);
  });

  it("accepts a valid scene and rejects a card over 6 words, a bad grid and an unknown emotion", () => {
    expect(ReelScene.parse(scene)).toEqual(scene);
    expect(
      ReelScene.safeParse({ ...scene, card: "one two three four five six seven" }).success,
    ).toBe(false);
    expect(ReelScene.safeParse({ ...scene, beats: 3.25 }).success).toBe(false);
    expect(ReelScene.safeParse({ ...scene, beats: 2.5 }).success).toBe(false);
    // reel-director@4 scenes last up to 3.5 s (7 beats), with a line and a frame prompt.
    expect(
      ReelScene.safeParse({ ...scene, beats: 7, line: "Why.", framePrompt: "A pot." }).success,
    ).toBe(true);
    expect(ReelScene.safeParse({ ...scene, beats: 7.5 }).success).toBe(false);
    expect(ReelScene.safeParse({ ...scene, emotion: "ANGER" }).success).toBe(false);
  });

  it("accepts a hook option", () => {
    const hook = {
      id: "h1",
      hookType: "DIRECT_QUESTION",
      card: "Hot water on **bulgur?**",
      ruleCard: "Only if it's **fine.**",
      claimSlideIds: ["s2"],
      rationale: "Doubts a familiar action, then promises a rule.",
    };
    expect(ReelHookOption.parse(hook)).toEqual(hook);
  });
});
