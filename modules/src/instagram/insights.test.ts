import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InstagramCallError } from "./errors";
import { createGraphClient, type GraphClient } from "./http";
import {
  getAccountInsights,
  getMediaInsights,
  isUnsupportedMetricError,
  loadMetricAvailability,
  MEDIA_METRICS,
  rememberUnsupportedMetrics,
  toSnapshotColumns,
} from "./insights";
import {
  capturingLogger,
  connectTestAccount,
  instagramFixture,
  mockRuntime,
  newMock,
} from "./test-support";

// The Insights client against the mock Graph API (M6-02): a full answer, a metric the media type
// refuses, an answer with holes, the account split of reach. Synthetic numbers only.

const ACCOUNT = "1784";

describe("Instagram insights client", () => {
  let t: TestDb;
  let mock: ReturnType<typeof newMock>;
  let fx: Awaited<ReturnType<typeof instagramFixture>>;
  let client: GraphClient;

  async function setup(options: Parameters<typeof newMock>[0] = {}) {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    mock = newMock(options);
    fx = await instagramFixture(t.db, mock);
    const { token } = await connectTestAccount(fx.ctx, mock, {
      marketId: fx.marketIds["es-ES"] as string,
      accountId: ACCOUNT,
    });
    client = createGraphClient(mockRuntime(mock), {
      accessToken: token,
      logger: capturingLogger().logger,
    });
  }
  beforeEach(async () => {
    await setup();
  });
  afterEach(async () => {
    await t.close();
  });

  const metricCalls = () => mock.callsTo(/\/insights$/);

  describe("media insights of a carousel", () => {
    it("reads every metric of the FEED list into its column", async () => {
      const mediaId = mock.addPublishedMedia(ACCOUNT, "CAROUSEL");
      mock.setMediaInsights(
        mediaId,
        {
          reach: 1000,
          views: 1500,
          likes: 90,
          comments: 6,
          saved: 40,
          shares: 12,
          total_interactions: 148,
          follows: 3,
          profile_visits: 25,
        },
        { BIO_LINK_CLICKED: 4, CALL: 1 },
      );
      const insights = await getMediaInsights(client, mediaId, "FEED");
      expect(insights.newlyUnsupported).toEqual([]);
      expect(insights.metrics.reach).toBe(1000);
      expect(insights.profileActivity).toEqual({ BIO_LINK_CLICKED: 4, CALL: 1 });
      expect(toSnapshotColumns(insights, "FEED")).toEqual({
        reach: 1000,
        views: 1500,
        likes: 90,
        comments: 6,
        saves: 40,
        shares: 12,
        totalInteractions: 148,
        followerChange: 3,
        profileActionsJson: {
          profileVisits: 25,
          follows: 3,
          profileActivity: { BIO_LINK_CLICKED: 4, CALL: 1 },
        },
        videoMetricsJson: null,
      });
      // Two calls: the plain metrics together, profile_activity alone with its breakdown.
      const calls = metricCalls();
      expect(calls).toHaveLength(2);
      expect(calls[0]?.query.metric).toBe(MEDIA_METRICS.FEED.join(","));
      expect(calls[1]?.query).toMatchObject({
        metric: "profile_activity",
        breakdown: "action_type",
      });
      expect(JSON.stringify(insights.raw)).toContain("insights/reach/lifetime");
    });

    it("keeps a metric Instagram did not report as null, never 0", async () => {
      const mediaId = mock.addPublishedMedia(ACCOUNT);
      mock.setMediaInsights(mediaId, { reach: 200, saved: 0, likes: 10 });
      const insights = await getMediaInsights(client, mediaId, "FEED");
      const columns = toSnapshotColumns(insights, "FEED");
      expect(columns).toMatchObject({
        reach: 200,
        saves: 0, // a real zero stays a zero
        likes: 10,
        views: null,
        shares: null,
        comments: null,
        totalInteractions: null,
        followerChange: null,
        profileActionsJson: null,
      });
    });

    it("never sends a period, and never a deprecated metric", async () => {
      const mediaId = mock.addPublishedMedia(ACCOUNT);
      await getMediaInsights(client, mediaId, "FEED");
      for (const call of metricCalls()) {
        expect(call.query).not.toHaveProperty("period");
        expect(call.query.metric).not.toMatch(/impressions|plays|video_views/);
      }
    });
  });

  describe("media insights of a Reel", () => {
    it("asks for the Reels list and files the watch metrics apart", async () => {
      const mediaId = mock.addPublishedMedia(ACCOUNT, "REELS");
      mock.setMediaInsights(mediaId, {
        reach: 800,
        views: 1200,
        likes: 70,
        comments: 4,
        saved: 30,
        shares: 9,
        total_interactions: 113,
        ig_reels_avg_watch_time: 6200,
        ig_reels_video_view_total_time: 7_440_000,
      });
      const insights = await getMediaInsights(client, mediaId, "REELS");
      const columns = toSnapshotColumns(insights, "REELS");
      expect(columns).toMatchObject({ reach: 800, saves: 30, followerChange: null });
      expect(columns.profileActionsJson).toBeNull();
      expect(columns.videoMetricsJson).toEqual({
        ig_reels_avg_watch_time: 6200,
        ig_reels_video_view_total_time: 7_440_000,
        reels_skip_rate: null,
      });
      // No profile_activity call for a Reel.
      expect(metricCalls()).toHaveLength(1);
    });
  });

  describe("a metric the media type does not support", () => {
    it("drops the metric the error names, asks again once, and reports it", async () => {
      // A carousel asked for a Reels metric: the mock refuses it by name.
      const mediaId = mock.addPublishedMedia(ACCOUNT, "CAROUSEL");
      mock.setMediaInsights(mediaId, { reach: 500, likes: 20 });
      mock.unsupportedMediaMetrics.FEED.add("profile_visits");
      const insights = await getMediaInsights(client, mediaId, "FEED");
      expect(insights.newlyUnsupported).toContain("profile_visits");
      expect(insights.metrics).not.toHaveProperty("profile_visits");
      expect(insights.metrics.reach).toBe(500);
      const plain = metricCalls().filter((c) => c.query.metric?.includes("reach"));
      expect(plain).toHaveLength(2);
      expect(plain[1]?.query.metric).not.toContain("profile_visits");
    });

    it("asks each metric alone when the error does not say which one", async () => {
      await t.close();
      await setup({ insightsErrorNamesMetric: false });
      const mediaId = mock.addPublishedMedia(ACCOUNT, "CAROUSEL");
      mock.setMediaInsights(mediaId, { reach: 500, likes: 20 });
      mock.unsupportedMediaMetrics.FEED.add("follows");
      const insights = await getMediaInsights(client, mediaId, "FEED");
      expect(insights.newlyUnsupported).toEqual(["follows"]);
      expect(insights.metrics).toMatchObject({ reach: 500, likes: 20, views: null });
      expect(insights.metrics).not.toHaveProperty("follows");
    });

    it("does not ask for a metric already known to be unsupported", async () => {
      const mediaId = mock.addPublishedMedia(ACCOUNT, "CAROUSEL");
      mock.setMediaInsights(mediaId, { reach: 500 });
      await getMediaInsights(client, mediaId, "FEED", new Set(["follows", "profile_activity"]));
      const calls = metricCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]?.query.metric).not.toContain("follows");
    });

    it("remembers what it learned in app_settings and merges with what was known", async () => {
      await rememberUnsupportedMetrics(fx.ctx, "FEED", ["follows"]);
      await rememberUnsupportedMetrics(fx.ctx, "FEED", ["profile_visits", "follows"]);
      await rememberUnsupportedMetrics(fx.ctx, "REELS", ["reels_skip_rate"]);
      await rememberUnsupportedMetrics(fx.ctx, "REELS", []);
      expect(await loadMetricAvailability(fx.ctx)).toEqual({
        FEED: ["follows", "profile_visits"],
        REELS: ["reels_skip_rate"],
      });
    });

    it("recognises the refusal by code 100 and the word metric, and nothing else", () => {
      const error = (over: Partial<InstagramCallError["error"]>) =>
        new InstagramCallError({
          message: "(#100) The metric x is not supported.",
          code: 100,
          httpStatus: 400,
          classification: "PERMANENT",
          ...over,
        });
      expect(isUnsupportedMetricError(error({}))).toBe(true);
      expect(isUnsupportedMetricError(error({ code: 190 }))).toBe(false);
      expect(isUnsupportedMetricError(error({ message: "Invalid parameter." }))).toBe(false);
      expect(isUnsupportedMetricError(error({ httpStatus: 500 }))).toBe(false);
    });
  });

  describe("errors that are not about a metric", () => {
    it("are thrown: a revoked token, a rate limit", async () => {
      const mediaId = mock.addPublishedMedia(ACCOUNT);
      mock.fail({
        path: /\/insights$/,
        status: 429,
        error: { message: "Application request limit reached", code: 80002 },
      });
      await expect(getMediaInsights(client, mediaId, "FEED")).rejects.toMatchObject({
        error: { classification: "RATE_LIMIT", code: 80002 },
      });
      mock.fail({
        path: /\/insights$/,
        status: 400,
        error: { message: "Invalid OAuth access token", code: 190 },
      });
      await expect(getMediaInsights(client, mediaId, "FEED")).rejects.toMatchObject({
        error: { classification: "AUTH" },
      });
    });
  });

  describe("account insights", () => {
    const window = { since: 1_790_000_000, until: 1_790_086_400 };

    it("splits reach into followers and non-followers and reads the rest", async () => {
      mock.setAccountInsights(ACCOUNT, {
        reachFollowers: 800,
        reachNonFollowers: 1700,
        reachUnknown: 50,
        views: 6000,
        accountsEngaged: 140,
        totalInteractions: 400,
        follows: 12,
        unfollows: 3,
      });
      const insights = await getAccountInsights(client, ACCOUNT, window);
      expect(insights).toMatchObject({
        followersCount: 1200,
        reach: 2550,
        reachFollowers: 800,
        reachNonFollowers: 1700,
        views: 6000,
        accountsEngaged: 140,
        totalInteractions: 400,
        follows: 12,
        unfollows: 3,
        unavailable: [],
      });
      const reachCall = metricCalls().find((c) => c.query.metric === "reach");
      expect(reachCall?.query).toMatchObject({
        period: "day",
        metric_type: "total_value",
        breakdown: "follow_type",
        since: String(window.since),
        until: String(window.until),
      });
    });

    it("keeps a missing metric null and a refused one in `unavailable`", async () => {
      mock.setAccountInsights(ACCOUNT, { reachFollowers: 10, views: 55 });
      // Under 100 followers Instagram refuses follows_and_unfollows.
      mock.unsupportedAccountMetrics.add("follows_and_unfollows");
      const insights = await getAccountInsights(client, ACCOUNT, window);
      expect(insights).toMatchObject({
        reach: 10,
        reachFollowers: 10,
        reachNonFollowers: null,
        views: 55,
        accountsEngaged: null,
        totalInteractions: null,
        follows: null,
        unfollows: null,
        unavailable: ["follows_and_unfollows"],
      });
    });

    it("stops on a token error instead of returning empty numbers", async () => {
      mock.fail({
        path: /\/insights$/,
        status: 400,
        error: { message: "Invalid OAuth access token", code: 190 },
      });
      await expect(getAccountInsights(client, ACCOUNT, window)).rejects.toMatchObject({
        error: { classification: "AUTH" },
      });
    });
  });
});
