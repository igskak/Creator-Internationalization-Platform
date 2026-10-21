import { schema } from "@rc/db";
import { and, eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { NotFoundError, TransientError } from "@rc/lib/errors";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ReviewFixture, recordingJobs, reviewFixture } from "../content/variants/test-support";
import { connectTestAccount, mockRuntime, newMock } from "../instagram/test-support";
import {
  collectAccountInsights,
  collectInsights,
  previousLocalDay,
  requestMetricsNow,
} from "./collect";

// J11 and J12 against the mock Graph API (M6-03): one snapshot per slot, a late slot with its real
// age, a failing post that does not block the others. Synthetic numbers only.

const T0 = new Date("2026-10-10T12:00:00Z");
const ES = "1784";
const EN = "1785";
const HOUR = 3_600_000;

describe("collecting insights", () => {
  let t: TestDb;
  let fx: ReviewFixture;
  let mock: ReturnType<typeof newMock>;
  let accounts: Record<string, typeof schema.socialAccounts.$inferSelect>;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    mock = newMock({ accounts: [], now: () => fx.clock.now() });
    fx = await reviewFixture(t.db, { instagram: mockRuntime(mock, { allowlist: [ES, EN] }) });
    const es = await connectTestAccount(fx.ctx, mock, {
      marketId: await marketId("es-ES"),
      accountId: ES,
      username: "kitchen_es",
    });
    const en = await connectTestAccount(fx.ctx, mock, {
      marketId: await marketId("en"),
      accountId: EN,
      username: "kitchen_en",
    });
    accounts = { [ES]: es.account, [EN]: en.account };
  });
  afterEach(async () => {
    await t.close();
  });

  async function marketId(code: string) {
    const [m] = await t.db.select().from(schema.markets).where(eq(schema.markets.code, code));
    return m?.id ?? "";
  }

  /** A published post of the account's market; its media has `metrics` ready on the mock. */
  async function published(
    opts: {
      account?: string;
      publishedAt?: Date;
      format?: "CAROUSEL" | "REEL";
      metrics?: Record<string, number>;
      profileActivity?: Record<string, number>;
    } = {},
  ) {
    const accountId = opts.account ?? ES;
    const account = accounts[accountId] as (typeof accounts)[string];
    const { variantId } = await fx.makeVariant({
      status: "PUBLISHED",
      marketCode: accountId === ES ? "es-ES" : "en",
    });
    if (opts.format === "REEL") {
      await t.db
        .update(schema.contentVariants)
        .set({ format: "REEL" })
        .where(eq(schema.contentVariants.id, variantId));
    }
    const { versionId } = await fx.makeVersion(variantId);
    const mediaId = mock.addPublishedMedia(
      accountId,
      opts.format === "REEL" ? "REELS" : "CAROUSEL",
    );
    mock.setMediaInsights(
      mediaId,
      opts.metrics ?? { reach: 1000, views: 1400, likes: 80, saved: 30, shares: 10, comments: 5 },
      opts.profileActivity,
    );
    const publicationId = await fx.makePublication(variantId, versionId, {
      status: "PUBLISHED",
      mode: "IMMEDIATE",
      publishedAt: opts.publishedAt ?? T0,
      instagramMediaId: mediaId,
      socialAccountId: account.id,
    });
    return { publicationId, mediaId, variantId };
  }

  const at = (hoursAfterT0: number) => fx.clock.set(new Date(T0.getTime() + hoursAfterT0 * HOUR));
  const snapshotsOf = (publicationId: string) =>
    t.db
      .select()
      .from(schema.metricSnapshots)
      .where(eq(schema.metricSnapshots.publicationId, publicationId))
      .orderBy(schema.metricSnapshots.mediaAgeHours);
  const events = () =>
    t.db
      .select()
      .from(schema.integrationEvents)
      .where(eq(schema.integrationEvents.integration, "instagram"));

  it("takes one snapshot per slot as each comes due, and never twice", async () => {
    const { publicationId } = await published();
    const slots: [number, string][] = [
      [1, ""],
      [2.2, "H2"],
      [24.3, "D1"],
      [72.5, "D3"],
      [169, "D7"],
      [673, "D28"],
    ];
    for (const [hours, slot] of slots) {
      at(hours);
      const run = await collectInsights(fx.ctx);
      expect(
        run.collected.map((c) => c.slot),
        `at ${hours} h`,
      ).toEqual(slot ? [slot] : []);
      // The same run again finds nothing more to do.
      expect((await collectInsights(fx.ctx)).collected).toEqual([]);
    }
    const rows = await snapshotsOf(publicationId);
    expect(rows.map((r) => r.snapshotSlot)).toEqual(["H2", "D1", "D3", "D7", "D28"]);
    expect(rows.map((r) => Number(r.mediaAgeHours))).toEqual([2.2, 24.3, 72.5, 169, 673]);
    expect(rows[0]).toMatchObject({ reach: 1000, saves: 30, apiVersion: "v25.0" });
  });

  it("stores a late slot with its real age and says it was late", async () => {
    const { publicationId } = await published();
    at(240); // first looked at on day ten
    const run = await collectInsights(fx.ctx);
    expect(run.collected).toEqual([
      expect.objectContaining({ slot: "D7", ageHours: 240, late: true }),
    ]);
    const rows = await snapshotsOf(publicationId);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.mediaAgeHours)).toBe(240);
    expect(rows[0]?.measuredAt.toISOString()).toBe(
      new Date(T0.getTime() + 240 * HOUR).toISOString(),
    );
  });

  it("keeps what Instagram did not report as null and lists it", async () => {
    const { publicationId } = await published({ metrics: { reach: 300, saved: 0 } });
    at(3);
    const run = await collectInsights(fx.ctx);
    expect(run.collected[0]?.missing).toEqual([
      "views",
      "likes",
      "comments",
      "shares",
      "totalInteractions",
    ]);
    const [row] = await snapshotsOf(publicationId);
    expect(row).toMatchObject({
      reach: 300,
      saves: 0,
      views: null,
      likes: null,
      followerChange: null,
    });
    expect(row?.rawMetricsJson).toBeTruthy();
  });

  it("files a carousel's profile activity and a Reel's watch metrics in their own columns", async () => {
    const carousel = await published({
      metrics: { reach: 500, follows: 2, profile_visits: 9 },
      profileActivity: { BIO_LINK_CLICKED: 3 },
    });
    const reel = await published({
      format: "REEL",
      metrics: { reach: 700, ig_reels_avg_watch_time: 5400 },
    });
    at(3);
    await collectInsights(fx.ctx);
    const [c] = await snapshotsOf(carousel.publicationId);
    expect(c).toMatchObject({
      followerChange: 2,
      profileActionsJson: {
        profileVisits: 9,
        follows: 2,
        profileActivity: { BIO_LINK_CLICKED: 3 },
      },
      videoMetricsJson: null,
    });
    // Already at H2: the watch metrics are asked for at every slot, not only from D3 on.
    const [r] = await snapshotsOf(reel.publicationId);
    expect(r).toMatchObject({
      snapshotSlot: "H2",
      reach: 700,
      profileActionsJson: null,
      videoMetricsJson: { ig_reels_avg_watch_time: 5400 },
    });
  });

  it("does not measure dry runs, unpublished posts or posts without a media id", async () => {
    const live = await published();
    const dry = await published();
    await t.db
      .update(schema.publications)
      .set({ dryRun: true })
      .where(eq(schema.publications.id, dry.publicationId));
    const failed = await published();
    await t.db
      .update(schema.publications)
      .set({ status: "FAILED" })
      .where(eq(schema.publications.id, failed.publicationId));
    const noMedia = await published();
    await t.db
      .update(schema.publications)
      .set({ instagramMediaId: null })
      .where(eq(schema.publications.id, noMedia.publicationId));
    at(3);
    const run = await collectInsights(fx.ctx);
    expect(run.collected.map((c) => c.publicationId)).toEqual([live.publicationId]);
  });

  it("lets one failing post fail alone, with one finding for the account, and clears it later", async () => {
    const broken = await published();
    const fine = await published();
    const other = await published({ account: EN });
    mock.fail({
      path: new RegExp(`/${broken.mediaId}/insights$`),
      status: 500,
      error: { message: "Something went wrong", code: 2 },
      times: 10,
    });
    at(3);
    const run = await collectInsights(fx.ctx);
    expect(run.collected.map((c) => c.publicationId).sort()).toEqual(
      [fine.publicationId, other.publicationId].sort(),
    );
    expect(run.failed).toEqual([{ publicationId: broken.publicationId, problem: "TRANSIENT" }]);
    expect(await snapshotsOf(broken.publicationId)).toHaveLength(0);
    // The failure is a finding on the account, once, and the sibling post that went well did not
    // close it.
    const open = (await events()).filter(
      (e) => e.code === "INSIGHTS_FAILED" && e.resolvedAt === null,
    );
    expect(open).toHaveLength(1);
    expect(open[0]?.details).toMatchObject({ publicationId: broken.publicationId });

    // The next run takes the post that failed, and the finding is resolved.
    mock.clearFaults();
    at(3.5);
    const again = await collectInsights(fx.ctx);
    expect(again.collected.map((c) => c.publicationId)).toEqual([broken.publicationId]);
    const unresolved = (await events()).filter(
      (e) => e.code === "INSIGHTS_FAILED" && e.resolvedAt === null,
    );
    expect(unresolved).toEqual([]);
  });

  it("marks an account NEEDS_REAUTH when Instagram refuses its token, and goes on with the other", async () => {
    const es = await published();
    const en = await published({ account: EN });
    mock.fail({
      path: /\/insights$/,
      status: 400,
      error: { message: "Invalid OAuth access token", code: 190 },
      times: 1,
    });
    at(3);
    const run = await collectInsights(fx.ctx);
    expect(run.failed).toHaveLength(1);
    expect(run.failed[0]?.problem).toBe("AUTH");
    const refused = run.failed[0]?.publicationId;
    expect([es.publicationId, en.publicationId]).toContain(refused);
    const [account] = await t.db
      .select()
      .from(schema.socialAccounts)
      .where(
        eq(
          schema.socialAccounts.id,
          refused === es.publicationId ? (accounts[ES]?.id ?? "") : (accounts[EN]?.id ?? ""),
        ),
      );
    expect(account?.status).toBe("NEEDS_REAUTH");
    // The other account's post was measured.
    expect(run.collected).toHaveLength(1);
  });

  it("stops at a rate limit, keeps what it stored, and rethrows for the job runner", async () => {
    const first = await published();
    await published();
    mock.fail({
      path: /\/insights$/,
      method: "GET",
      skip: 2, // the first post's two calls (plain, profile activity) go through
      status: 429,
      error: { message: "Application request limit reached", code: 80002 },
      times: 5,
    });
    at(3);
    await expect(collectInsights(fx.ctx)).rejects.toBeInstanceOf(TransientError);
    expect(await snapshotsOf(first.publicationId)).toHaveLength(1);
    const limited = (await events()).filter((e) => e.code === "INSIGHTS_RATE_LIMITED");
    expect(limited).toHaveLength(1);
  });

  it("measures at most `limit` posts per run, the longest overdue first", async () => {
    const old = await published({ publishedAt: new Date(T0.getTime() - 50 * HOUR) });
    const newer = await published({ publishedAt: new Date(T0.getTime() - 5 * HOUR) });
    const newest = await published({ publishedAt: new Date(T0.getTime() - 3 * HOUR) });
    const run = await collectInsights(fx.ctx, {}, { limit: 2 });
    // Due since: D1 of the oldest (24 h after publishing), then H2 of the others.
    expect(run.collected.map((c) => c.publicationId)).toEqual([
      old.publicationId,
      newer.publicationId,
    ]);
    expect(run.deferred).toBe(1);
    const next = await collectInsights(fx.ctx, {}, { limit: 2 });
    expect(next.collected.map((c) => c.publicationId)).toEqual([newest.publicationId]);
  });

  describe("a metric Instagram refuses", () => {
    it("is remembered and not asked for again", async () => {
      await published();
      await published({ account: EN });
      mock.unsupportedMediaMetrics.FEED.add("profile_visits");
      at(3);
      await collectInsights(fx.ctx);
      const asked = mock
        .callsTo(/\/insights$/)
        .filter((c) => c.query.metric?.includes("reach"))
        .map((c) => c.query.metric?.includes("profile_visits"));
      // The first post learned it (two plain calls); the second asked without it.
      expect(asked).toEqual([true, false, false]);
      const [setting] = await t.db
        .select()
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, "instagram.metric_availability"));
      expect(setting?.value).toEqual({ FEED: ["profile_visits"] });
    });
  });

  describe("a manual snapshot", () => {
    it("measures one post now, as often as asked, next to the automatic ones", async () => {
      const { publicationId } = await published();
      at(5);
      await collectInsights(fx.ctx, { publicationId, slot: "MANUAL" });
      at(6);
      await collectInsights(fx.ctx, { publicationId, slot: "MANUAL" });
      const rows = await snapshotsOf(publicationId);
      expect(rows.map((r) => r.snapshotSlot)).toEqual(["MANUAL", "MANUAL"]);
      expect(rows.map((r) => Number(r.mediaAgeHours))).toEqual([5, 6]);
    });

    it("refuses a post that is not published on Instagram", async () => {
      const { variantId } = await fx.makeVariant({ status: "APPROVED" });
      const { versionId } = await fx.makeVersion(variantId);
      const publicationId = await fx.makePublication(variantId, versionId, {
        status: "SCHEDULED",
      });
      await expect(
        collectInsights(fx.ctx, { publicationId, slot: "MANUAL" }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("account insights", () => {
    it("reads the local day before: the window and the date follow the market's zone", () => {
      // 02:17 UTC on 14 Oct is 04:17 in Madrid (UTC+2): the day before is 13 Oct, 22:00Z–22:00Z.
      const madrid = previousLocalDay(new Date("2026-10-14T02:17:00Z"), "Europe/Madrid");
      expect(madrid.metricDate).toBe("2026-10-13");
      expect(new Date(madrid.since * 1000).toISOString()).toBe("2026-10-12T22:00:00.000Z");
      expect(new Date((madrid.until + 1) * 1000).toISOString()).toBe("2026-10-13T22:00:00.000Z");
      // The same moment is 22:17 on 13 Oct in New York (UTC-4): the day before is 12 Oct.
      const ny = previousLocalDay(new Date("2026-10-14T02:17:00Z"), "America/New_York");
      expect(ny.metricDate).toBe("2026-10-12");
      expect(new Date(ny.since * 1000).toISOString()).toBe("2026-10-12T04:00:00.000Z");
      // A day with 25 hours (clocks go back in Madrid on 25 Oct).
      const long = previousLocalDay(new Date("2026-10-26T05:00:00Z"), "Europe/Madrid");
      expect(long.metricDate).toBe("2026-10-25");
      expect(long.until + 1 - long.since).toBe(25 * 3600);
    });

    it("stores the day per account, overwrites it on a second run, keeps unknowns null", async () => {
      // 08:17 UTC: 10:17 in Madrid, 04:17 in New York; both markets have finished 13 Oct.
      fx.clock.set(new Date("2026-10-14T08:17:00Z"));
      mock.setAccountInsights(ES, {
        reachFollowers: 800,
        reachNonFollowers: 1700,
        views: 6000,
        accountsEngaged: 140,
        follows: 12,
        unfollows: 3,
      });
      mock.setAccountInsights(EN, { reachFollowers: 100, reachNonFollowers: 300 });
      mock.unsupportedAccountMetrics.add("follows_and_unfollows");
      const run = await collectAccountInsights(fx.ctx);
      expect(run.failed).toEqual([]);
      expect(run.collected).toHaveLength(2);
      const rowOf = async (accountId: string) =>
        (
          await t.db
            .select()
            .from(schema.accountMetricSnapshots)
            .where(
              and(eq(schema.accountMetricSnapshots.socialAccountId, accounts[accountId]?.id ?? "")),
            )
        )[0];
      expect(await rowOf(EN)).toMatchObject({
        metricDate: "2026-10-13",
        reachFollowers: 100,
        reachNonFollowers: 300,
        views: null,
        follows: null,
        followersCount: 1200,
      });
      expect(await rowOf(ES)).toMatchObject({ metricDate: "2026-10-13" });

      // The second run of the day overwrites; there is still one row per account.
      mock.setAccountInsights(ES, { reachFollowers: 900, reachNonFollowers: 1800 });
      mock.unsupportedAccountMetrics.clear();
      fx.clock.set(new Date("2026-10-14T09:00:00Z"));
      await collectAccountInsights(fx.ctx, { socialAccountId: accounts[ES]?.id ?? "" });
      const all = await t.db.select().from(schema.accountMetricSnapshots);
      expect(all).toHaveLength(2);
      expect(await rowOf(ES)).toMatchObject({ reachFollowers: 900, reachNonFollowers: 1800 });
    });

    it("reads each market once its night has passed 02:00, and a stored day only once", async () => {
      mock.setAccountInsights(ES, { reachFollowers: 10 });
      mock.setAccountInsights(EN, { reachFollowers: 20 });
      const reason = (run: Awaited<ReturnType<typeof collectAccountInsights>>, id: string) =>
        run.skipped.find((s) => s.socialAccountId === accounts[id]?.id)?.reason;
      // 02:17 UTC: 04:17 in Madrid (its 13 Oct), 22:17 on 13 Oct in New York (its last finished
      // day is 12 Oct, not stored yet, so it is caught up).
      fx.clock.set(new Date("2026-10-14T02:17:00Z"));
      const first = await collectAccountInsights(fx.ctx);
      expect(first.collected.map((c) => c.metricDate).sort()).toEqual(["2026-10-12", "2026-10-13"]);
      // 04:30 UTC: 00:30 in New York; 13 Oct has just ended there, Meta gets two hours to add it up.
      fx.clock.set(new Date("2026-10-14T04:30:00Z"));
      const early = await collectAccountInsights(fx.ctx);
      expect(early.collected).toEqual([]);
      expect(reason(early, EN)).toBe("TOO_EARLY");
      expect(reason(early, ES)).toBe("DONE");
      // 06:17 UTC: 02:17 in New York, its 13 Oct is read; Madrid's is stored already.
      fx.clock.set(new Date("2026-10-14T06:17:00Z"));
      const second = await collectAccountInsights(fx.ctx);
      expect(second.collected).toEqual([
        expect.objectContaining({ socialAccountId: accounts[EN]?.id, metricDate: "2026-10-13" }),
      ]);
      expect(reason(second, ES)).toBe("DONE");
      // Later runs that day call Instagram for nobody.
      const calls = mock.calls.length;
      fx.clock.set(new Date("2026-10-14T07:17:00Z"));
      const third = await collectAccountInsights(fx.ctx);
      expect(third.collected).toEqual([]);
      expect(third.skipped.map((s) => s.reason)).toEqual(["DONE", "DONE"]);
      expect(mock.calls.length).toBe(calls);
      expect(await t.db.select().from(schema.accountMetricSnapshots)).toHaveLength(3);
    });

    it("sets an account NEEDS_REAUTH on a refused token and goes on", async () => {
      fx.clock.set(new Date("2026-10-14T08:17:00Z"));
      mock.setAccountInsights(EN, { reachFollowers: 1 });
      mock.fail({
        path: /\/insights$/,
        status: 400,
        error: { message: "Invalid OAuth access token", code: 190 },
        times: 1,
      });
      const run = await collectAccountInsights(fx.ctx);
      expect(run.failed).toHaveLength(1);
      expect(run.collected).toHaveLength(1);
      const refused = await t.db
        .select()
        .from(schema.socialAccounts)
        .where(eq(schema.socialAccounts.status, "NEEDS_REAUTH"));
      expect(refused).toHaveLength(1);
    });
  });
});

describe("collect metrics now", () => {
  let t: TestDb;
  let fx: ReviewFixture;
  let jobs: ReturnType<typeof recordingJobs>;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    jobs = recordingJobs();
    fx = await reviewFixture(t.db, { jobs: jobs.runner });
  });
  afterEach(async () => {
    await t.close();
  });

  const post = async (over: Partial<typeof schema.publications.$inferInsert>) => {
    const { variantId } = await fx.makeVariant({ status: "PUBLISHED" });
    const { versionId } = await fx.makeVersion(variantId);
    return fx.makePublication(variantId, versionId, over);
  };

  it("starts J11 for one published post with the MANUAL slot, and writes an audit event", async () => {
    const publicationId = await post({
      status: "PUBLISHED",
      mode: "IMMEDIATE",
      publishedAt: T0,
      instagramMediaId: "1790001",
    });
    const { runId } = await requestMetricsNow(fx.ctx, { publicationId });
    expect(runId).toBeTruthy();
    expect(jobs.calls).toHaveLength(1);
    expect(jobs.calls[0]).toMatchObject({
      name: "collect-insights",
      payload: { publicationId, slot: "MANUAL" },
    });
    const audits = await t.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "insights.collect_requested"));
    expect(audits).toHaveLength(1);
  });

  it("refuses a post that is not published on Instagram, a dry run, and an unknown id", async () => {
    const scheduled = await post({ status: "SCHEDULED", mode: "SCHEDULED" });
    await expect(requestMetricsNow(fx.ctx, { publicationId: scheduled })).rejects.toMatchObject({
      name: "InvalidStateError",
    });
    const dry = await post({
      status: "PUBLISHED",
      mode: "IMMEDIATE",
      dryRun: true,
      instagramMediaId: "1790002",
    });
    await expect(requestMetricsNow(fx.ctx, { publicationId: dry })).rejects.toMatchObject({
      name: "InvalidStateError",
    });
    await expect(
      requestMetricsNow(fx.ctx, { publicationId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(jobs.calls).toHaveLength(0);
  });
});
