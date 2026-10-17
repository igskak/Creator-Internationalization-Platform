import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { createFakeVideoProvider } from "@rc/lib/providers/video";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { approveVariant } from "./content";
import type { PublishMode, ServiceContext } from "./core";
import { connectTestAccount, mockRuntime, newMock } from "./instagram/test-support";
import { runPublication, schedulePublication } from "./publishing";
import { generateReel, requestReel } from "./reels";
import { type ReelFixture, reelFixture, stubAssemble } from "./reels/generate/test-support";
import {
  dryRunYouTubeUpload,
  getYouTubeStatus,
  retryYouTubeUpload,
  runYouTubeUpload,
  syncYouTubeShorts,
} from "./youtube";
import {
  newYouTubeMock,
  TEST_CHANNEL_ID,
  type YouTubeMock,
  type YouTubeMockOptions,
  youtubeRuntime,
} from "./youtube/test-support";

// A Reel that Instagram published goes to YouTube as a Short (G-09): the guards, the dry run, the
// resumable upload that is never repeated blindly, and the rows it leaves. The fake YouTube is
// in memory; nothing here reaches Google. It crosses the reels, publishing and youtube domains, so
// it lives at the root of the modules, like reel-publishing.test.ts. Synthetic content only.

const IG_ACCOUNT = "1784";

describe("YouTube Shorts", () => {
  let t: TestDb;
  let fx: ReelFixture;
  let yt: YouTubeMock;
  let reelId: string;
  let marketCode: string;
  let publicationId: string;

  async function setSetting(key: string, value: unknown) {
    await t.db
      .insert(schema.appSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
  }

  /** A Reel approved and published on the mock Instagram, then a context that can reach YouTube. */
  async function setup(
    opts: {
      mode?: PublishMode;
      enabled?: boolean;
      youtube?: Partial<YouTubeMockOptions>;
      market?: string;
      channel?: string;
    } = {},
  ) {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    const mock = newMock({ accounts: [], now: () => fx.clock.now(), finishAfterPolls: 1 });
    fx = await reelFixture(t.db, {
      instagram: mockRuntime(mock, { publishMode: "live", allowlist: [IG_ACCOUNT] }),
    });
    const jobCtx: ServiceContext = {
      ...fx.ctx,
      actor: { type: "JOB", jobRunId: "ig-run" },
      sleep: async (ms) => {
        fx.clock.advance(ms);
      },
    };
    await setSetting("publishing.enabled", true);
    await fx.setEnabled(true);
    ({ variantId: reelId } = await requestReel(fx.ctx, {
      carouselVariantId: fx.carouselId,
      confirmEstimateUsd: 2.5,
    }));
    await generateReel(
      fx.jobCtx({ video: createFakeVideoProvider() }),
      { variantId: reelId, requestId: "r1" },
      { assemble: stubAssemble().assemble },
    );
    await connectTestAccount(fx.ctx, mock, {
      marketId: fx.marketId,
      accountId: IG_ACCOUNT,
      username: "kitchen",
    });
    mock.addAccount({ id: IG_ACCOUNT, username: "kitchen", followers: 100 });
    const [variant] = await t.db
      .select()
      .from(schema.contentVariants)
      .where(eq(schema.contentVariants.id, reelId));
    await approveVariant(fx.ctx, {
      variantId: reelId,
      lockVersion: variant?.lockVersion ?? 0,
      checklist: { factsChecked: true },
    });
    const { publication } = await schedulePublication(fx.ctx, {
      variantId: reelId,
      scheduledAt: new Date(fx.clock.now().getTime() + 3_600_000).toISOString(),
    });
    publicationId = publication.id;
    await t.db
      .update(schema.publications)
      .set({ status: "QUEUED" })
      .where(eq(schema.publications.id, publicationId));
    const outcome = await runPublication(jobCtx, { publicationId });
    expect(outcome).toMatchObject({ status: "PUBLISHED" });

    const [market] = await t.db
      .select()
      .from(schema.markets)
      .where(eq(schema.markets.id, fx.marketId));
    marketCode = market?.code ?? "";
    yt = newYouTubeMock({ now: () => fx.clock.now(), ...opts.youtube });
    if (opts.enabled !== false) await setSetting("youtube.enabled", true);
    return ytCtx(opts);
  }

  function ytCtx(
    opts: { mode?: PublishMode; market?: string; channel?: string } = {},
    runId = "yt-run-1",
  ): ServiceContext {
    return {
      ...fx.ctx,
      actor: { type: "JOB", jobRunId: runId },
      sleep: async (ms) => {
        fx.clock.advance(ms);
      },
      youtube: youtubeRuntime(yt, {
        publishMode: opts.mode ?? "live",
        marketCode: opts.market ?? marketCode,
        channelId: opts.channel ?? TEST_CHANNEL_ID,
      }),
    };
  }

  const uploads = () => t.db.select().from(schema.youtubeUploads);
  const calls = (op: string) => yt.calls.filter((c) => c.op === op);

  afterEach(async () => {
    await t.close();
  });

  describe("switches", () => {
    it("does nothing while YOUTUBE_PUBLISH_MODE is off, without a call to Google", async () => {
      const ctx = await setup();
      const result = await syncYouTubeShorts({
        ...ctx,
        youtube: { ...ctx.youtube, publishMode: "off", app: undefined },
      });
      expect(result).toEqual({ status: "OFF" });
      expect(yt.calls).toHaveLength(0);
      expect(await uploads()).toHaveLength(0);
    });

    it("does nothing while the owner's switch youtube.enabled is off", async () => {
      const ctx = await setup({ enabled: false });
      expect(await syncYouTubeShorts(ctx)).toEqual({ status: "DISABLED" });
      expect(yt.calls).toHaveLength(0);
      expect(await uploads()).toHaveLength(0);
    });

    it("leaves a Reel that Instagram has not published alone", async () => {
      const ctx = await setup();
      await t.db
        .update(schema.publications)
        .set({ status: "FAILED" })
        .where(eq(schema.publications.id, publicationId));
      expect(await syncYouTubeShorts(ctx)).toEqual({ status: "NOTHING_TO_DO" });
    });

    it("leaves a Reel that was published more than 30 days ago alone", async () => {
      const ctx = await setup();
      await t.db
        .update(schema.publications)
        .set({ publishedAt: new Date(fx.clock.now().getTime() - 31 * 86_400_000) })
        .where(eq(schema.publications.id, publicationId));
      expect(await syncYouTubeShorts(ctx)).toEqual({ status: "NOTHING_TO_DO" });
    });
  });

  describe("dry run", () => {
    it("checks the guards, the token and the channel, stores the metadata and uploads nothing", async () => {
      const ctx = await setup({ enabled: true });
      const result = await syncYouTubeShorts(ytCtx({ mode: "dry_run_only" }));
      expect(result).toMatchObject({ status: "RAN", outcome: { status: "DRY_RUN_PASSED" } });
      void ctx;
      const [row] = await uploads();
      expect(row).toMatchObject({
        status: "DRY_RUN_PASSED",
        dryRun: true,
        channelId: TEST_CHANNEL_ID,
        youtubeVideoId: null,
        uploadSessionEncrypted: null,
      });
      expect(row?.metadata).toMatchObject({
        privacyStatus: "private",
        categoryId: "26",
        containsSyntheticMedia: true,
      });
      expect(row?.metadata?.description).toContain("#Shorts");
      expect(calls("upload.start")).toHaveLength(0);
      expect(yt.puts()).toHaveLength(0);
      expect(yt.videos.size).toBe(0);
    });

    it("the CLI dry run needs no switch and does not repeat for the same Reel", async () => {
      await setup({ enabled: false });
      const ctx = ytCtx({ mode: "dry_run_only" });
      const { outcome } = await dryRunYouTubeUpload(ctx);
      expect(outcome.status).toBe("DRY_RUN_PASSED");
      await expect(dryRunYouTubeUpload(ctx)).rejects.toThrow(/No published Reel/);
      expect(yt.puts()).toHaveLength(0);
    });

    it("a dry-run environment never uploads, even with a stale live row", async () => {
      await setup();
      const ctx = ytCtx({ mode: "dry_run_only" });
      const { uploadId } = await dryRunYouTubeUpload(ctx);
      const liveInDryEnv = await runYouTubeUpload(ctx, { uploadId });
      expect(liveInDryEnv.status).toBe("NOOP");
    });
  });

  describe("live upload", () => {
    it("sends the approved video once with the Reel's hook line, no Instagram ask and #Shorts, private first", async () => {
      const ctx = await setup();
      const result = await syncYouTubeShorts(ctx);
      expect(result).toMatchObject({ status: "RAN", outcome: { status: "PUBLISHED" } });

      const [row] = await uploads();
      expect(row).toMatchObject({
        status: "PUBLISHED",
        dryRun: false,
        publicationId,
        uploadSessionEncrypted: null,
      });
      expect(row?.url).toBe(`https://www.youtube.com/shorts/${row?.youtubeVideoId}`);
      expect(yt.videos.size).toBe(1);
      expect(yt.puts()).toHaveLength(1);

      const [session] = [...yt.sessions.values()];
      const resource = session?.resource as {
        snippet: { title: string; description: string; defaultLanguage: string };
        status: Record<string, unknown>;
      };
      const [version] = await t.db.select().from(schema.contentVariantVersions);
      const caption = version?.snapshot.caption ?? "";
      expect(resource.snippet.title).toBe(
        caption
          .split(/\n\s*\n/u)[0]
          ?.replace(/\s+/gu, " ")
          .trim()
          .slice(0, 100),
      );
      expect(resource.snippet.description).toContain("#Shorts");
      expect(resource.snippet.description).not.toContain(version?.snapshot.cta.text ?? "\u0000");
      expect(resource.status).toEqual({
        privacyStatus: "private",
        selfDeclaredMadeForKids: false,
        containsSyntheticMedia: true,
      });
      expect(session?.total).toBe(version?.snapshot.reel?.bytes);

      // The Reel is on YouTube once: the cron has nothing more to do.
      expect(await syncYouTubeShorts(ctx)).toEqual({ status: "NOTHING_TO_DO" });
      expect(yt.videos.size).toBe(1);
    });

    it("cannot hold two live uploads of one Reel, whatever the code does", async () => {
      const ctx = await setup();
      await syncYouTubeShorts(ctx);
      const [first] = await uploads();
      await expect(
        t.db.insert(schema.youtubeUploads).values({
          contentVariantId: reelId,
          contentVariantVersionId: first?.contentVariantVersionId ?? "",
          publicationId,
          marketId: fx.marketId,
        }),
      ).rejects.toThrow();
    });

    it("follows the privacy setting", async () => {
      const ctx = await setup();
      await setSetting("youtube.privacy_status", "unlisted");
      await syncYouTubeShorts(ctx);
      const [session] = [...yt.sessions.values()];
      expect(session?.resource).toMatchObject({ status: { privacyStatus: "unlisted" } });
    });

    it("keeps no token, session address or secret in the rows, the audit or the status", async () => {
      const ctx = await setup();
      await syncYouTubeShorts(ctx);
      const audits = await t.db.select().from(schema.auditEvents);
      const status = await getYouTubeStatus(ctx);
      const everything = JSON.stringify([await uploads(), audits, status]);
      for (const secret of [
        "fake-access-token",
        "fake-refresh-token",
        "fake-client-secret",
        "upload_id=",
      ]) {
        expect(everything).not.toContain(secret);
      }
      expect(audits.map((a) => a.action)).toEqual(
        expect.arrayContaining(["youtube.uploaded", "youtube.published"]),
      );
    });

    it("calls a Short that YouTube is still processing published, after the polls", async () => {
      const ctx = await setup({ youtube: { processAfterPolls: 100 } });
      const result = await syncYouTubeShorts(ctx);
      expect(result).toMatchObject({ outcome: { status: "PUBLISHED" } });
      expect(calls("GET /videos").length).toBe(10);
      const [row] = await uploads();
      expect(row).toMatchObject({
        status: "PUBLISHED",
        uploadStatus: "uploaded",
        processingStatus: "processing",
      });
    });

    it("fails with YouTube's reason when the Short is rejected, keeping the video id", async () => {
      const ctx = await setup({ youtube: { rejectReason: "duplicate" } });
      const result = await syncYouTubeShorts(ctx);
      expect(result).toMatchObject({
        outcome: { status: "FAILED", error: { type: "GUARD_REJECTED" } },
      });
      const [row] = await uploads();
      expect(row?.status).toBe("FAILED");
      expect(row?.youtubeVideoId).not.toBeNull();
      expect(row?.lastError?.message).toContain("duplicate");
    });
  });

  describe("guards", () => {
    it("does not even pick a Reel of another market", async () => {
      await setup();
      expect(await syncYouTubeShorts(ytCtx({ market: "fr-FR" }))).toEqual({
        status: "NOTHING_TO_DO",
      });
      expect(yt.calls).toHaveLength(0);
    });

    it.each([
      ["a row of another market", { market: "fr-FR" }, "GUARD_WRONG_MARKET"],
      ["another channel", { channel: "UCotherchannel00000000000" }, "GUARD_WRONG_CHANNEL"],
    ])("stops before any byte for %s", async (_name, over, type) => {
      await setup();
      const [version] = await t.db.select().from(schema.contentVariantVersions);
      const [row] = await t.db
        .insert(schema.youtubeUploads)
        .values({
          contentVariantId: reelId,
          contentVariantVersionId: version?.id ?? "",
          publicationId,
          marketId: fx.marketId,
        })
        .returning();
      const outcome = await runYouTubeUpload(ytCtx(over), { uploadId: row?.id ?? "" });
      expect(outcome).toMatchObject({ status: "FAILED", error: { type } });
      expect(calls("upload.start")).toHaveLength(0);
      expect(yt.puts()).toHaveLength(0);
    });

    it("stops when the stored video is not the approved one", async () => {
      const ctx = await setup();
      const [version] = await t.db.select().from(schema.contentVariantVersions);
      const key = version?.snapshot.reel?.videoKey ?? "";
      await fx.storage.put(key, new Uint8Array([1, 2, 3]), { contentType: "video/mp4" });
      const result = await syncYouTubeShorts(ctx);
      expect(result).toMatchObject({
        outcome: { status: "FAILED", error: { type: "GUARD_VIDEO_CHANGED" } },
      });
      expect(yt.puts()).toHaveLength(0);
      expect(calls("token")).toHaveLength(0);
    });

    it("stops when the text names the source brand", async () => {
      const ctx = await setup();
      const [version] = await t.db.select().from(schema.contentVariantVersions);
      await t.db
        .update(schema.contentVariantVersions)
        .set({
          snapshot: {
            ...version!.snapshot,
            caption: `Reg.Chef rice rule.\n\n${version!.snapshot.caption}`,
          },
        })
        .where(eq(schema.contentVariantVersions.id, version!.id));
      const result = await syncYouTubeShorts(ctx);
      expect(result).toMatchObject({
        outcome: { status: "FAILED", error: { type: "GUARD_BRAND_TEXT" } },
      });
      expect(yt.puts()).toHaveLength(0);
    });

    it("leaves a FAILED upload to a person: the cron skips it, retry makes a new attempt", async () => {
      const ctx = await setup({ youtube: { rejectReason: "duplicate" } });
      await syncYouTubeShorts(ctx);
      expect(await syncYouTubeShorts(ctx)).toEqual({ status: "NOTHING_TO_DO" });
      const [failed] = await uploads();
      yt = newYouTubeMock({ now: () => fx.clock.now() });
      const retried = await retryYouTubeUpload(ytCtx(), { uploadId: failed?.id ?? "" });
      expect(retried.outcome.status).toBe("PUBLISHED");
      expect(await uploads()).toHaveLength(2);
      await expect(retryYouTubeUpload(ytCtx(), { uploadId: retried.uploadId })).rejects.toThrow(
        /failed live/,
      );
    });
  });

  describe("errors and resuming", () => {
    it("fails and raises a Health event when Google refuses the refresh token", async () => {
      const ctx = await setup({ youtube: { tokenError: "invalid_grant" } });
      const result = await syncYouTubeShorts(ctx);
      expect(result).toMatchObject({
        outcome: { status: "FAILED", error: { classification: "AUTH" } },
      });
      const events = await t.db.select().from(schema.integrationEvents);
      expect(events).toEqual([
        expect.objectContaining({ integration: "youtube", code: "YOUTUBE_REAUTH" }),
      ]);
    });

    it("keeps the upload for a retry when the quota is used up, with no byte sent", async () => {
      const ctx = await setup({ youtube: { startError: "quotaExceeded" } });
      await expect(syncYouTubeShorts(ctx)).rejects.toMatchObject({ name: "TransientError" });
      const [row] = await uploads();
      expect(row).toMatchObject({
        status: "IN_PROGRESS",
        step: "UPLOAD",
        triggerRunId: null,
        uploadStartedAt: null,
      });
      expect(yt.puts()).toHaveLength(0);
    });

    it("asks the same session after a lost answer and never makes a second video", async () => {
      const ctx = await setup();
      yt.dropNextPut("afterReceive");
      await expect(syncYouTubeShorts(ctx)).rejects.toMatchObject({ name: "TransientError" });
      expect(yt.videos.size).toBe(1);

      const result = await syncYouTubeShorts(ytCtx({}, "yt-run-2"));
      expect(result).toMatchObject({ outcome: { status: "PUBLISHED" } });
      expect(yt.videos.size).toBe(1);
      expect(yt.sessions.size).toBe(1);
      expect(calls("upload.start")).toHaveLength(1);
      expect(yt.puts()).toHaveLength(1);
      expect(calls("upload.query")).toHaveLength(1);
    });

    it("sends the bytes into the same session when the first call never arrived", async () => {
      const ctx = await setup();
      yt.dropNextPut("beforeReceive");
      await expect(syncYouTubeShorts(ctx)).rejects.toMatchObject({ name: "TransientError" });
      expect(yt.videos.size).toBe(0);

      const result = await syncYouTubeShorts(ytCtx({}, "yt-run-2"));
      expect(result).toMatchObject({ outcome: { status: "PUBLISHED" } });
      expect(yt.videos.size).toBe(1);
      expect(yt.sessions.size).toBe(1);
    });

    it("finds its own video on the channel when the session expired after the bytes arrived", async () => {
      const ctx = await setup();
      yt.dropNextPut("afterReceive");
      await expect(syncYouTubeShorts(ctx)).rejects.toMatchObject({ name: "TransientError" });
      yt.expireSessions();
      const result = await syncYouTubeShorts(ytCtx({}, "yt-run-2"));
      expect(result).toMatchObject({ outcome: { status: "PUBLISHED" } });
      expect(yt.videos.size).toBe(1);
      expect(calls("upload.start")).toHaveLength(1);
    });

    it("stops for a person, and does not upload again, when it cannot tell", async () => {
      const ctx = await setup();
      yt.dropNextPut("beforeReceive");
      await expect(syncYouTubeShorts(ctx)).rejects.toMatchObject({ name: "TransientError" });
      yt.expireSessions();
      const result = await syncYouTubeShorts(ytCtx({}, "yt-run-2"));
      expect(result).toMatchObject({
        outcome: { status: "FAILED", error: { type: "MANUAL_CHECK_REQUIRED" } },
      });
      expect(calls("upload.start")).toHaveLength(1);
      expect(yt.videos.size).toBe(0);
      const events = await t.db.select().from(schema.integrationEvents);
      expect(events.map((e) => e.code)).toEqual(["YOUTUBE_MANUAL_CHECK"]);
    });

    it("starts a new session when the old one expired before any byte was sent", async () => {
      const ctx = await setup({ youtube: { startError: "quotaExceeded" } });
      await expect(syncYouTubeShorts(ctx)).rejects.toThrow();
      yt = newYouTubeMock({ now: () => fx.clock.now() });
      const result = await syncYouTubeShorts(ytCtx({}, "yt-run-2"));
      expect(result).toMatchObject({ outcome: { status: "PUBLISHED" } });
      expect(yt.videos.size).toBe(1);
    });

    it("steps aside for a run that is alive", async () => {
      const ctx = await setup();
      yt.dropNextPut("afterReceive");
      await expect(syncYouTubeShorts(ctx)).rejects.toThrow();
      const [row] = await uploads();
      await t.db
        .update(schema.youtubeUploads)
        .set({ triggerRunId: "yt-run-1" })
        .where(eq(schema.youtubeUploads.id, row?.id ?? ""));
      const outcome = await runYouTubeUpload(ytCtx({}, "yt-run-2"), { uploadId: row?.id ?? "" });
      expect(outcome).toEqual({ status: "IN_FLIGHT" });
    });

    it("ends FAILED after five attempts that may pass", async () => {
      const ctx = await setup({ youtube: { startError: "quotaExceeded" } });
      for (let i = 1; i <= 4; i += 1) {
        await expect(syncYouTubeShorts(ytCtx({}, `r${i}`))).rejects.toThrow();
      }
      const result = await syncYouTubeShorts(ytCtx({}, "r5"));
      expect(result).toMatchObject({
        outcome: { status: "FAILED", error: { classification: "RATE_LIMIT" } },
      });
      void ctx;
    });
  });
});
