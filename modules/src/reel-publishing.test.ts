import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { createFakeVideoProvider } from "@rc/lib/providers/video";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  approveVariant,
  listDrafts,
  rejectVariant,
  unapproveVariant,
  verifyApprovedVersion,
} from "./content";
import type { ServiceContext } from "./core";
import { connectTestAccount, mockRuntime, newMock } from "./instagram/test-support";
import {
  checkG3Readiness,
  formatG3Readiness,
  getCalendar,
  listApprovedNotScheduled,
  runPublication,
  schedulePublication,
} from "./publishing";
import { generateReel, getReelView, requestReel, setReelTrial } from "./reels";
import { type ReelFixture, reelFixture, stubAssemble } from "./reels/generate/test-support";

// A Reel from review to Instagram (M8-09): approve and reject, the queues, then the publish
// machine's REELS branch against the mock Graph API (dry run and live). It crosses the content,
// reels and publishing domains, so it lives at the root of the modules. Synthetic content only.

const ES_ACCOUNT = "1784";

describe("Reel review and publishing", () => {
  let t: TestDb;
  let fx: ReelFixture;
  let mock: ReturnType<typeof newMock>;
  let jobCtx: ServiceContext;
  let reelId: string;

  async function setup(mode: "live" | "dry_run_only" = "live", fetchFails = false) {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    mock = newMock({
      accounts: [],
      now: () => fx.clock.now(),
      finishAfterPolls: 3,
      ...(fetchFails ? { unfetchableUrlPart: "reels/" } : {}),
    });
    fx = await reelFixture(t.db, {
      instagram: mockRuntime(mock, { publishMode: mode, allowlist: [ES_ACCOUNT] }),
    });
    jobCtx = {
      ...fx.ctx,
      actor: { type: "JOB", jobRunId: "run-1" },
      sleep: async (ms) => {
        fx.clock.advance(ms);
      },
    };
    await t.db
      .insert(schema.appSettings)
      .values({ key: "publishing.enabled", value: true })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: true } });
    await fx.setEnabled(true);
    ({ variantId: reelId } = await requestReel(fx.ctx, {
      carouselVariantId: fx.carouselId,
      confirmEstimateUsd: 2.8,
    }));
    await generateReel(
      fx.jobCtx({ video: createFakeVideoProvider() }),
      { variantId: reelId, requestId: "r1" },
      { assemble: stubAssemble().assemble },
    );
    await connectTestAccount(fx.ctx, mock, {
      marketId: fx.marketId,
      accountId: ES_ACCOUNT,
      username: "kitchen_es",
    });
    mock.addAccount({ id: ES_ACCOUNT, username: "kitchen_es", followers: 100 });
  }
  afterEach(async () => {
    await t.close();
  });

  const reel = () => fx.variant(reelId);
  const approve = async () =>
    approveVariant(fx.ctx, {
      variantId: reelId,
      lockVersion: (await reel()).lockVersion,
      checklist: { factsChecked: true },
    });

  describe("review", () => {
    beforeEach(async () => {
      await setup();
    });

    it("offers approve, reject and editing its post on a finished Reel, not the carousel's other actions", async () => {
      const view = await getReelView(fx.ctx, fx.carouselId);
      const actions = view.reel?.allowed.map((a) => a.action);
      // "edit" is the Reel's caption, ask and hashtags (G-01); field regeneration and renders are not offered.
      expect(actions?.sort()).toEqual(["approve", "edit", "reject", "requestChanges"]);
      expect(view.reel?.allowed.find((a) => a.action === "approve")).toMatchObject({
        enabled: true,
        checklist: ["factsChecked"],
      });
      expect(view.reel?.lockVersion).toBe((await reel()).lockVersion);
    });

    it("approves: the snapshot freezes the video file, its hash and the caption", async () => {
      const result = await approve();
      expect(result.variant.status).toBe("APPROVED");
      const [version] = await t.db
        .select()
        .from(schema.contentVariantVersions)
        .where(eq(schema.contentVariantVersions.id, result.versionId));
      const [render] = await t.db.select().from(schema.reelRenders);
      expect(version).toMatchObject({ carouselRenderId: null, reelRenderId: render?.id });
      expect(version?.snapshot).toMatchObject({
        format: "REEL",
        slides: [],
        renderId: render?.id,
        caption: (await reel()).caption,
        reel: {
          videoKey: render?.storageKey,
          sha256: render?.sha256,
          width: 1080,
          height: 1920,
          durationMs: 14_880,
          chosenHookId: "h1",
        },
      });
      expect(version?.snapshot.reel?.cards).toHaveLength(6);
      expect(version?.snapshot.hook).not.toContain("**");
      expect(await verifyApprovedVersion(fx.ctx, result.versionId)).toEqual({
        ok: true,
        problems: [],
      });
      // An approved Reel is in use: it is not changed or generated again.
      expect((await getReelView(fx.ctx, fx.carouselId)).blockedBy).toBe("reel_in_use");
    });

    it("refuses to approve a Reel whose video is older than its script", async () => {
      const [script] = await t.db.select().from(schema.reelScripts);
      await t.db.insert(schema.reelScripts).values({
        contentVariantId: reelId,
        version: 2,
        hookOptions: script?.hookOptions ?? [],
        chosenHookId: "h2",
        scenes: script?.scenes ?? [],
        shotModel: script?.shotModel ?? "alibaba/wan-3.0",
      });
      await expect(approve()).rejects.toMatchObject({
        details: { blockers: [expect.objectContaining({ code: "RENDER_STALE" })] },
      });
    });

    it("notices a video that changed after approval", async () => {
      const { versionId } = await approve();
      await t.db.update(schema.reelRenders).set({ sha256: "0".repeat(64) });
      expect((await verifyApprovedVersion(fx.ctx, versionId)).problems).toContain(
        "The video file is not the one in the snapshot.",
      );
    });

    it("rejects a Reel, which frees the slot for a new one", async () => {
      await rejectVariant(fx.ctx, { variantId: reelId, reasonCode: "WEAK_HOOK" });
      expect((await reel()).status).toBe("REJECTED");
      const view = await getReelView(fx.ctx, fx.carouselId);
      expect(view.reel).toBeNull();
      expect(view.blockedBy).toBeNull();
    });

    it("withdraws an approval and can approve again as version 2", async () => {
      await approve();
      await unapproveVariant(fx.ctx, { variantId: reelId, reason: "Wrong hook." });
      expect((await reel()).status).toBe("READY_FOR_REVIEW");
      expect((await approve()).versionNo).toBe(2);
    });

    it("puts Reels in the draft queue with their format, and in the calendar's side list", async () => {
      const review = await listDrafts(fx.ctx, { tab: "REVIEW" });
      expect(review.rows.find((r) => r.variantId === reelId)).toMatchObject({ format: "REEL" });
      await approve();
      const approved = await listDrafts(fx.ctx, { tab: "APPROVED" });
      expect(approved.rows.map((r) => r.variantId)).toContain(reelId);
      const waiting = await listApprovedNotScheduled(fx.ctx);
      expect(waiting.find((d) => d.variantId === reelId)).toMatchObject({
        format: "REEL",
        thumbnailUrl: null,
      });
    });
  });

  describe("publishing", () => {
    it("sends the carousel's cover slide as the Reel's grid cover (carousel v3, R3)", async () => {
      await setup("dry_run_only");
      // The source carousel was rendered: its first slide is in storage.
      const slideKey = "renders/test/cover/0.jpg";
      await fx.storage.put(
        slideKey,
        new Uint8Array(
          await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#f4f4f4" } })
            .jpeg()
            .toBuffer(),
        ),
        { contentType: "image/jpeg" },
      );
      const [render] = await t.db
        .insert(schema.carouselRenders)
        .values({
          contentVariantId: fx.carouselId,
          inputHash: "cover-test",
          status: "READY",
          slideCount: 1,
          templatesVersion: "A@3.0.0",
        })
        .returning({ id: schema.carouselRenders.id });
      await t.db.insert(schema.renderedSlides).values({
        carouselRenderId: render?.id ?? "",
        slideIndex: 0,
        slideId: "c1",
        templateId: "A",
        storageKey: slideKey,
        width: 1080,
        height: 1350,
        bytes: 1000,
        sha256: "x",
      });
      await t.db
        .update(schema.contentVariants)
        .set({ currentRenderId: render?.id ?? null })
        .where(eq(schema.contentVariants.id, fx.carouselId));

      const approved = await approve();
      const [version] = await t.db
        .select()
        .from(schema.contentVariantVersions)
        .where(eq(schema.contentVariantVersions.id, approved.versionId));
      const cover = version?.snapshot.reel?.cover;
      expect(cover?.key).toMatch(/^renders\/reels\/.+\/cover-.+\.jpg$/);
      const stored = await fx.storage.getBytes(cover?.key ?? "");
      expect(await sharp(stored).metadata()).toMatchObject({ width: 1080, height: 1920 });

      const { publication } = await schedulePublication(fx.ctx, {
        variantId: reelId,
        dryRun: true,
      });
      await runPublication(jobCtx, { publicationId: publication.id });
      const post = mock.calls.find((c) => c.method === "POST" && c.path.endsWith("/media"));
      expect(String(post?.body.cover_url)).toContain("cover-");
    });

    it("a dry run makes the REELS container, waits for FINISHED and publishes nothing", async () => {
      await setup("dry_run_only");
      await approve();
      const { publication } = await schedulePublication(fx.ctx, {
        variantId: reelId,
        dryRun: true,
      });
      const outcome = await runPublication(jobCtx, { publicationId: publication.id });
      expect(outcome).toEqual({ status: "DRY_RUN_PASSED" });

      const posts = mock.calls.filter((c) => c.method === "POST" && c.path.endsWith("/media"));
      expect(posts).toHaveLength(1);
      expect(posts[0]?.body).toMatchObject({
        media_type: "REELS",
        share_to_feed: true,
        caption: expect.any(String),
      });
      expect(String(posts[0]?.body.video_url)).toContain("reels/");
      expect(posts[0]?.body).not.toHaveProperty("children");
      // The carousel was never rendered, so there is no cover: Instagram takes the first frame.
      expect(posts[0]?.body).not.toHaveProperty("cover_url");
      expect(mock.calls.some((c) => c.path.endsWith("/media_publish"))).toBe(false);
      const [row] = await t.db
        .select()
        .from(schema.publications)
        .where(eq(schema.publications.id, publication.id));
      expect(row).toMatchObject({
        status: "DRY_RUN_PASSED",
        igContainerStatus: "FINISHED",
        igChildrenContainerIds: [],
      });
      expect((await reel()).status).toBe("APPROVED");

      // Gate G3: the Reel dry run passed, the approved Reel waits, no live Reel yet.
      const g3 = await checkG3Readiness(fx.ctx);
      expect(g3.items.map((i) => [i.id, i.state])).toEqual([
        [1, "MANUAL"],
        [2, "PASS"],
        [3, "PASS"],
        [4, "MANUAL"],
      ]);
      expect(g3.items[3]?.details).toEqual(["No live Reel publication exists yet."]);
      expect(formatG3Readiness(g3)).toContain("Gate G3 readiness");
    });

    it("sends a trial Reel with its graduation, and fixes the choice once it is out (M8-11)", async () => {
      await setup("dry_run_only");
      // Off by default: no trial_params on the container.
      expect((await getReelView(fx.ctx, fx.carouselId)).reel?.trialGraduation).toBeNull();
      await expect(
        setReelTrial(fx.as("chef"), { variantId: reelId, graduation: "MANUAL" }),
      ).rejects.toThrow();
      await expect(
        setReelTrial(fx.ctx, { variantId: fx.carouselId, graduation: "MANUAL" }),
      ).rejects.toThrow("Only a Reel can be a trial.");
      await setReelTrial(fx.ctx, { variantId: reelId, graduation: "SS_PERFORMANCE" });
      expect((await getReelView(fx.ctx, fx.carouselId)).reel?.trialGraduation).toBe(
        "SS_PERFORMANCE",
      );
      await approve();
      const { publication } = await schedulePublication(fx.ctx, {
        variantId: reelId,
        dryRun: true,
      });
      await runPublication(jobCtx, { publicationId: publication.id });
      const [post] = mock.calls.filter((c) => c.method === "POST" && c.path.endsWith("/media"));
      expect(post?.body).toMatchObject({
        media_type: "REELS",
        trial_params: JSON.stringify({ graduation_strategy: "SS_PERFORMANCE" }),
      });
      // Back to a normal Reel while it is only approved; a published one would refuse the change.
      await setReelTrial(fx.ctx, { variantId: reelId, graduation: null });
      await t.db
        .update(schema.contentVariants)
        .set({ status: "PUBLISHED" })
        .where(eq(schema.contentVariants.id, reelId));
      await expect(
        setReelTrial(fx.ctx, { variantId: reelId, graduation: "MANUAL" }),
      ).rejects.toThrow("fixed");
    });

    it("publishes a scheduled Reel and the calendar shows it with a Reel badge", async () => {
      await setup("live");
      await approve();
      const at = new Date(fx.clock.now().getTime() + 60 * 60_000);
      const { publication } = await schedulePublication(fx.ctx, {
        variantId: reelId,
        scheduledAt: at.toISOString(),
      });
      const items = await getCalendar(fx.ctx, {
        from: new Date(at.getTime() - 86_400_000).toISOString(),
        to: new Date(at.getTime() + 86_400_000).toISOString(),
      });
      expect(items.find((i) => i.variantId === reelId)).toMatchObject({
        format: "REEL",
        thumbnailUrl: null,
      });

      await t.db
        .update(schema.publications)
        .set({ status: "QUEUED" })
        .where(eq(schema.publications.id, publication.id));
      const outcome = await runPublication(jobCtx, { publicationId: publication.id });
      expect(outcome).toMatchObject({ status: "PUBLISHED" });
      expect((await reel()).status).toBe("PUBLISHED");
      const [media] = [...mock.media.values()];
      expect(media?.caption).toBe(
        (posts(mock)[0]?.body.caption as string | undefined) ?? "missing",
      );
    });

    it("refuses a Reel whose stored video is not the approved one", async () => {
      await setup("dry_run_only");
      await approve();
      const [render] = await t.db.select().from(schema.reelRenders);
      await fx.storage.put(render?.storageKey ?? "", Buffer.from("other bytes"), {
        contentType: "video/mp4",
      });
      const { publication } = await schedulePublication(fx.ctx, {
        variantId: reelId,
        dryRun: true,
      });
      const outcome = await runPublication(jobCtx, { publicationId: publication.id });
      expect(outcome).toMatchObject({ status: "FAILED", error: { type: "GUARD_VIDEO_CHANGED" } });
      expect(posts(mock)).toHaveLength(0);
    });

    it("makes the container again once when Meta cannot fetch the video, then fails", async () => {
      await setup("dry_run_only", true);
      await approve();
      const { publication } = await schedulePublication(fx.ctx, {
        variantId: reelId,
        dryRun: true,
      });
      const outcome = await runPublication(jobCtx, { publicationId: publication.id });
      expect(outcome).toMatchObject({
        status: "FAILED",
        error: { classification: "INVALID_MEDIA", subcode: 2207052 },
      });
      expect(posts(mock)).toHaveLength(2);
    });
  });
});

const posts = (mock: ReturnType<typeof newMock>) =>
  mock.calls.filter((c) => c.method === "POST" && c.path.endsWith("/media"));
