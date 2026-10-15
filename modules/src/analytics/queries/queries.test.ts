import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { ValidationError } from "@rc/lib/errors";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ReviewFixture, reviewFixture } from "../../content/variants/test-support";
import {
  getContentLearning,
  getEngagement,
  getGrowth,
  getOperations,
  getRankedPosts,
  LEARNING_DIMENSIONS,
} from "./index";

// The dashboard queries on a fixture with known answers (M6-04). Synthetic numbers only.

const WINDOW = { from: "2026-10-01T00:00:00Z", to: "2026-11-01T00:00:00Z" };
const at = (iso: string) => new Date(iso);

describe("analytics queries", () => {
  let t: TestDb;
  let fx: ReviewFixture;
  const marketIds: Record<string, string> = {};

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    fx = await reviewFixture(t.db);
    for (const m of await t.db.select().from(schema.markets)) marketIds[m.code] = m.id;
  });
  afterEach(async () => {
    await t.close();
  });

  type PostOptions = {
    market?: "es-ES" | "en";
    publishedAt?: string;
    hookType?: string | null;
    visualStyle?: string;
    ctaType?: string;
    slides?: number;
    captionChars?: number;
    templates?: string[];
    version?: string;
    format?: "CAROUSEL" | "REEL";
    /** Snapshots: [slot, ageHours, metrics]. */
    snapshots?: [
      "H2" | "D1" | "D3" | "D7" | "D28" | "MANUAL",
      number,
      Partial<typeof schema.metricSnapshots.$inferInsert>,
    ][];
  };

  /** A published post with its snapshots. */
  async function post(opts: PostOptions = {}) {
    const market = opts.market ?? "es-ES";
    const { variantId } = await fx.makeVariant({ status: "PUBLISHED", marketCode: market });
    await t.db
      .update(schema.contentVariants)
      .set({
        hookType: opts.hookType === undefined ? "QUESTION" : opts.hookType,
        visualStyle: opts.visualStyle ?? "WARM",
        ctaType: opts.ctaType ?? "SAVE",
        templateSequence: opts.templates ?? ["A", "B", "F"],
        contentLength: {
          slides: opts.slides ?? 6,
          wordsTotal: 80,
          captionChars: opts.captionChars ?? 300,
        },
        generationVersion: opts.version ?? "p1.7.0",
        format: opts.format ?? "CAROUSEL",
      })
      .where(eq(schema.contentVariants.id, variantId));
    const { versionId } = await fx.makeVersion(variantId);
    const publicationId = await fx.makePublication(variantId, versionId, {
      status: "PUBLISHED",
      mode: "IMMEDIATE",
      publishedAt: at(opts.publishedAt ?? "2026-10-10T09:00:00Z"),
      permalink: `https://www.instagram.com/p/${variantId.slice(0, 6)}/`,
    });
    for (const [slot, age, values] of opts.snapshots ?? []) {
      await t.db.insert(schema.metricSnapshots).values({
        publicationId,
        snapshotSlot: slot,
        measuredAt: at("2026-10-20T00:00:00Z"),
        mediaAgeHours: String(age),
        rawMetricsJson: {},
        apiVersion: "v25.0",
        ...values,
      });
    }
    return { publicationId, variantId };
  }
  /** A D7 snapshot with `saves` of `reach`. */
  const d7 = (reach: number, saves: number, shares = 0): NonNullable<PostOptions["snapshots"]> => [
    ["D7", 168, { reach, saves, shares, comments: 0, likes: 0 }],
  ];

  describe("getGrowth", () => {
    async function account(market: "es-ES" | "en", id: string) {
      const [row] = await t.db
        .insert(schema.socialAccounts)
        .values({
          marketId: marketIds[market] ?? "",
          username: `acct_${id}`,
          instagramAccountId: id,
          accessTokenEncrypted: "enc:v1:x",
        })
        .returning();
      return row?.id ?? "";
    }
    const day = (
      accountId: string,
      date: string,
      v: Partial<typeof schema.accountMetricSnapshots.$inferInsert>,
    ) =>
      t.db.insert(schema.accountMetricSnapshots).values({
        socialAccountId: accountId,
        metricDate: date,
        measuredAt: at(`${date}T23:00:00Z`),
        raw: {},
        apiVersion: "v25.0",
        ...v,
      });

    it("gives the tiles and series of one market, with the non-follower share of reach", async () => {
      const es = await account("es-ES", "9001");
      await day(es, "2026-10-01", {
        followersCount: 1000,
        reach: 400,
        reachFollowers: 300,
        reachNonFollowers: 100,
      });
      await day(es, "2026-10-02", {
        followersCount: 1010,
        reach: 600,
        reachFollowers: 300,
        reachNonFollowers: 300,
      });
      await day(es, "2026-10-03", {
        followersCount: 1030,
        reach: null,
        reachFollowers: null,
        reachNonFollowers: null,
      });
      const g = await getGrowth(fx.ctx, { ...WINDOW, marketId: marketIds["es-ES"] ?? "" });
      expect(g.tiles).toEqual({
        followers: 1030,
        followerGrowth: 30,
        avgDailyReach: 500, // the day without reach is not a zero day
        nonFollowerShare: 400 / 1000,
        days: 3,
      });
      expect(g.followersSeries).toEqual([
        { date: "2026-10-01", value: 1000 },
        { date: "2026-10-02", value: 1010 },
        { date: "2026-10-03", value: 1030 },
      ]);
      expect(g.reachSeries.at(-1)).toEqual({ date: "2026-10-03", value: null });
      expect(g.nonFollowerShareSeries.map((p) => p.value)).toEqual([0.25, 0.5, null]);
    });

    it("keeps markets apart, adds them up without a market filter and respects the window", async () => {
      const es = await account("es-ES", "9001");
      const en = await account("en", "9002");
      await day(es, "2026-10-05", {
        followersCount: 1000,
        reach: 100,
        reachFollowers: 80,
        reachNonFollowers: 20,
      });
      await day(en, "2026-10-05", {
        followersCount: 500,
        reach: 300,
        reachFollowers: 100,
        reachNonFollowers: 200,
      });
      await day(es, "2026-09-30", { followersCount: 1, reach: 1 }); // before the window
      await day(es, "2026-11-01", { followersCount: 2, reach: 2 }); // the window ends before it
      const all = await getGrowth(fx.ctx, WINDOW);
      expect(all.tiles).toMatchObject({ followers: 1500, avgDailyReach: 400, days: 1 });
      expect(all.tiles.nonFollowerShare).toBeCloseTo(220 / 400, 6);
      const onlyEn = await getGrowth(fx.ctx, { ...WINDOW, marketId: marketIds.en ?? "" });
      expect(onlyEn.tiles).toMatchObject({ followers: 500, avgDailyReach: 300 });
    });

    it("answers with nulls and no series when there is no data, and refuses a bad window", async () => {
      const g = await getGrowth(fx.ctx, WINDOW);
      expect(g.tiles).toEqual({
        followers: null,
        followerGrowth: null,
        avgDailyReach: null,
        nonFollowerShare: null,
        days: 0,
      });
      expect(g.followersSeries).toEqual([]);
      await expect(getGrowth(fx.ctx, { from: WINDOW.to, to: WINDOW.from })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(
        getGrowth(fx.ctx, { from: "2024-01-01T00:00:00Z", to: "2026-01-01T00:00:00Z" }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("getEngagement", () => {
    it("takes D7 rates per post and their medians; the D3 fallback is flagged", async () => {
      await post({ snapshots: d7(1000, 100, 50) }); // save .10, share .05
      await post({ snapshots: d7(1000, 200, 100) }); // .20 / .10
      await post({ snapshots: d7(1000, 300, 150) }); // .30 / .15
      await post({ snapshots: [["D3", 75, { reach: 500, saves: 25, shares: 5 }]] }); // .05 / .01, fallback
      const e = await getEngagement(fx.ctx, WINDOW);
      expect(e.tiles).toMatchObject({ posts: 4, withRates: 4, exactD7: 3 });
      expect(e.tiles.medianSaveRate).toBeCloseTo(0.15, 6); // of .05 .10 .20 .30
      expect(e.tiles.medianShareRate).toBeCloseTo(0.075, 6); // of .01 .05 .10 .15
      expect(e.tiles.medianReach).toBe(1000);
      const fallback = e.posts.find((p) => p.metrics?.slot === "D3");
      expect(fallback?.metrics).toMatchObject({ isExactD7: false, ageHours: 75, saveRate: 0.05 });
    });

    it("lists a post that has no numbers yet without rates, and leaves a post with no reach out of the medians", async () => {
      await post({ snapshots: d7(1000, 100) });
      const young = await post({ snapshots: [["D1", 24, { reach: 300, saves: 30 }]] });
      const silent = await post({ snapshots: d7(0, 5) });
      const e = await getEngagement(fx.ctx, WINDOW);
      expect(e.tiles).toMatchObject({ posts: 3, withRates: 1, medianSaveRate: 0.1 });
      expect(e.posts.find((p) => p.publicationId === young.publicationId)?.metrics).toBeNull();
      expect(e.posts.find((p) => p.publicationId === silent.publicationId)?.metrics).toMatchObject({
        reach: 0,
        saveRate: null,
      });
    });

    it("filters by market and by the day the post was published, newest first", async () => {
      await post({ market: "es-ES", publishedAt: "2026-10-05T09:00:00Z", snapshots: d7(100, 10) });
      await post({ market: "en", publishedAt: "2026-10-06T09:00:00Z", snapshots: d7(100, 20) });
      await post({ market: "es-ES", publishedAt: "2026-09-20T09:00:00Z", snapshots: d7(100, 30) });
      const es = await getEngagement(fx.ctx, { ...WINDOW, marketId: marketIds["es-ES"] ?? "" });
      expect(es.posts).toHaveLength(1);
      expect(es.tiles.medianSaveRate).toBeCloseTo(0.1, 6);
      const all = await getEngagement(fx.ctx, WINDOW);
      expect(all.posts.map((p) => p.marketCode)).toEqual(["en", "es-ES"]);
    });

    it("carries what the table needs: the hook, the hook type, the link, the format", async () => {
      await post({ format: "REEL", hookType: "MYTH_BUST", snapshots: d7(100, 10) });
      const [row] = (await getEngagement(fx.ctx, WINDOW)).posts;
      expect(row).toMatchObject({ format: "REEL", hookType: "MYTH_BUST" });
      expect(row?.permalink).toContain("instagram.com/p/");
      expect(row?.hook).toBeTruthy();
    });
  });

  describe("getContentLearning", () => {
    const esId = () => marketIds["es-ES"] ?? "";
    const learn = (
      dimension: (typeof LEARNING_DIMENSIONS)[number],
      extra: { minSample?: number } = {},
    ) => getContentLearning(fx.ctx, { marketId: esId(), dimension, ...WINDOW, ...extra });

    async function hookFixture() {
      // MYTH_BUST: save rates .30 .20 .10 (median .20); QUESTION: .05 .05 (median .05); no hook type: .10
      for (const saves of [300, 200, 100])
        await post({ hookType: "MYTH_BUST", snapshots: d7(1000, saves, 100) });
      for (const saves of [50, 50])
        await post({ hookType: "QUESTION", snapshots: d7(1000, saves, 20) });
      await post({ hookType: null, snapshots: d7(1000, 100, 0) });
    }

    it("groups by a dimension with medians, lift against the market and the low-sample mark", async () => {
      await hookFixture();
      const result = await learn("hook_type");
      // Market median of .30 .20 .10 .05 .05 .10 = .10.
      expect(result.market).toMatchObject({ n: 6, medianReach: 1000 });
      expect(result.market.medianSaveRate).toBeCloseTo(0.1, 6);
      expect(result.minSample).toBe(3);
      expect(result.rows.map((r) => r.value)).toEqual(["MYTH_BUST", "NONE", "QUESTION"]);
      const [myth, none, question] = result.rows;
      expect(myth).toMatchObject({ n: 3, lowSample: false });
      expect(myth?.medianSaveRate).toBeCloseTo(0.2, 6);
      expect(myth?.liftVsMarket).toBeCloseTo(2, 6);
      expect(myth?.medianShareRate).toBeCloseTo(0.1, 6);
      expect(none).toMatchObject({ n: 1, lowSample: true });
      expect(question).toMatchObject({ n: 2, lowSample: true });
      expect(question?.liftVsMarket).toBeCloseTo(0.5, 6);
    });

    it("takes the minimum sample from the setting, and from the request before it", async () => {
      await hookFixture();
      await t.db
        .insert(schema.appSettings)
        .values({ key: "analytics.min_sample", value: 2 })
        .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: 2 } });
      const byHook = (await learn("hook_type")).rows;
      expect(byHook.find((r) => r.value === "QUESTION")?.lowSample).toBe(false);
      const stricter = (await learn("hook_type", { minSample: 4 })).rows;
      expect(stricter.every((r) => r.lowSample)).toBe(true);
    });

    it("never counts a post of another market, another window or without D7 numbers", async () => {
      await post({ hookType: "MYTH_BUST", snapshots: d7(1000, 100) });
      await post({ market: "en", hookType: "MYTH_BUST", snapshots: d7(1000, 900) });
      await post({
        hookType: "MYTH_BUST",
        publishedAt: "2026-09-01T09:00:00Z",
        snapshots: d7(1000, 900),
      });
      await post({ hookType: "MYTH_BUST", snapshots: [["D1", 24, { reach: 100, saves: 99 }]] });
      const result = await learn("hook_type");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({ value: "MYTH_BUST", n: 1 });
    });

    it("has a lift of null when the market's median is zero", async () => {
      await post({ hookType: "A", snapshots: d7(1000, 0) });
      await post({ hookType: "B", snapshots: d7(1000, 0) });
      const result = await learn("hook_type");
      expect(result.market.medianSaveRate).toBe(0);
      expect(result.rows.every((r) => r.liftVsMarket === null)).toBe(true);
    });

    it("reads every dimension of the list", async () => {
      await post({
        hookType: "MYTH_BUST",
        visualStyle: "DARK",
        ctaType: "SHARE",
        slides: 6,
        captionChars: 450,
        templates: ["A", "E", "F"],
        version: "p1.7.0",
        publishedAt: "2026-10-14T22:30:00Z", // Wednesday 22:30 UTC = Thursday 00:30 in Madrid
        snapshots: d7(1000, 100),
      });
      const values: Record<string, string> = {};
      for (const dimension of LEARNING_DIMENSIONS) {
        values[dimension] = (await learn(dimension)).rows[0]?.value ?? "";
      }
      expect(values).toMatchObject({
        category: "GRAINS_RICE_PASTA",
        angle: "COMMON_MISTAKE",
        hook_type: "MYTH_BUST",
        format: "CAROUSEL",
        visual_style: "DARK",
        cta_type: "SHARE",
        offer: "NONE",
        daypart: "NIGHT",
        weekday: "4",
        slide_count: "6-7",
        caption_length: "301-600",
        first_template: "A",
        template_sequence: "A>E>F",
        generation_version: "p1.7.0",
      });
    });

    it("refuses a dimension that is not on the list, however it is spelled", async () => {
      for (const dimension of ["hook_type; drop table content_variants", "password", "d.format"]) {
        await expect(
          getContentLearning(fx.ctx, {
            marketId: esId(),
            dimension: dimension as never,
            ...WINDOW,
          }),
        ).rejects.toBeInstanceOf(ValidationError);
      }
    });
  });

  describe("getRankedPosts", () => {
    it("lists the best and the worst by save rate, never a post twice, with a thumbnail for a carousel", async () => {
      const ids: string[] = [];
      for (const saves of [10, 20, 30, 40, 50]) {
        ids.push((await post({ snapshots: d7(1000, saves) })).publicationId);
      }
      const reel = await post({ format: "REEL", snapshots: d7(1000, 60) });
      const result = await getRankedPosts(fx.ctx, { ...WINDOW, limit: 2 });
      expect(result.considered).toBe(6);
      expect(result.top.map((p) => p.publicationId)).toEqual([reel.publicationId, ids[4]]);
      expect(result.top[0]?.value).toBeCloseTo(0.06, 6);
      expect(result.bottom.map((p) => p.publicationId)).toEqual([ids[0], ids[1]]);
      expect(result.top[1]?.thumbnailUrl).toBeTruthy();
    });

    it("with fewer posts than twice the limit, the bottom is only what the top left over", async () => {
      const a = await post({ snapshots: d7(1000, 10) });
      const b = await post({ snapshots: d7(1000, 20) });
      const c = await post({ snapshots: d7(1000, 30) });
      const result = await getRankedPosts(fx.ctx, { ...WINDOW, limit: 2 });
      expect(result.top.map((p) => p.publicationId)).toEqual([c.publicationId, b.publicationId]);
      expect(result.bottom.map((p) => p.publicationId)).toEqual([a.publicationId]);
    });

    it("ranks by reach when asked, and leaves out posts without that number", async () => {
      await post({ snapshots: d7(500, 1) });
      const big = await post({ snapshots: d7(5000, 1) });
      await post({ snapshots: [["D1", 24, { reach: 99999 }]] });
      const result = await getRankedPosts(fx.ctx, { ...WINDOW, metric: "reach", limit: 1 });
      expect(result.top[0]?.publicationId).toBe(big.publicationId);
      expect(result.considered).toBe(2);
    });
  });

  describe("getOperations", () => {
    async function variantWith(market: "es-ES" | "en" = "es-ES") {
      return (await fx.makeVariant({ status: "READY_FOR_REVIEW", marketCode: market })).variantId;
    }
    const audit = (variantId: string, action: string, when: string) =>
      t.db.insert(schema.auditEvents).values({
        actorType: "SYSTEM",
        action,
        entityType: "content_variant",
        entityId: variantId,
        occurredAt: at(when),
      });
    const review = (
      variantId: string,
      action: (typeof schema.reviewEvents.$inferInsert)["action"],
      when: string,
      over: Partial<typeof schema.reviewEvents.$inferInsert> = {},
    ) =>
      t.db.insert(schema.reviewEvents).values({
        contentVariantId: variantId,
        action,
        variantLockVersion: 0,
        createdAt: at(when),
        ...over,
      });
    const run = (variantId: string, costUsd: string) =>
      t.db.insert(schema.generationRuns).values({
        stage: "CONTENT_WRITING",
        promptId: "content-writer",
        promptVersion: 5,
        promptHash: "h",
        provider: "fake",
        model: "fake",
        params: {},
        inputHash: `i-${Math.random()}`,
        status: "SUCCEEDED",
        costUsd,
        contentVariantId: variantId,
      });

    it("counts what was generated, approved and rejected, with the reasons", async () => {
      const [a, b, c, d] = [
        await variantWith(),
        await variantWith(),
        await variantWith(),
        await variantWith(),
      ];
      for (const v of [a, b, c, d])
        await audit(v as string, "variant.generated", "2026-10-10T08:00:00Z");
      await review(a as string, "APPROVE", "2026-10-10T10:00:00Z");
      await review(b as string, "APPROVE", "2026-10-10T12:00:00Z");
      await review(c as string, "REJECT", "2026-10-10T11:00:00Z", { reasonCode: "WEAK_HOOK" });
      await review(d as string, "REJECT", "2026-10-11T11:00:00Z", { reasonCode: "WEAK_HOOK" });
      const o = await getOperations(fx.ctx, WINDOW);
      expect(o).toMatchObject({ generated: 4, approved: 2, rejected: 2, approvalRate: 0.5 });
      expect(o.rejectionReasons).toEqual([{ code: "WEAK_HOOK", count: 2 }]);
    });

    it("averages the edits an approved post got before its approval, and the time to approve", async () => {
      const a = await variantWith();
      const b = await variantWith();
      await audit(a, "variant.generated", "2026-10-10T08:00:00Z");
      await audit(b, "variant.generated", "2026-10-10T08:00:00Z");
      // a: two edits, one after the approval (not counted), approved after 2 h.
      await review(a, "EDIT", "2026-10-10T08:30:00Z");
      await review(a, "EDIT", "2026-10-10T09:00:00Z");
      await review(a, "APPROVE", "2026-10-10T10:00:00Z");
      await review(a, "EDIT", "2026-10-10T11:00:00Z");
      // b: no edit, sent back and resubmitted at 12:00, approved at 16:00 (4 h from the resubmit).
      await audit(b, "variant.resubmitted", "2026-10-10T12:00:00Z");
      await review(b, "APPROVE", "2026-10-10T16:00:00Z");
      const o = await getOperations(fx.ctx, WINDOW);
      expect(o.avgEditsPerApproved).toBe(1); // (2 + 0) / 2
      expect(o.medianTimeToApproveHours).toBe(3); // median of 2 h and 4 h
    });

    it("reports the critic's first-pass rate and regenerations per variant", async () => {
      const pass = { verdict: "PASS", iteration: 0 };
      const rewritten = { verdict: "PASS", iteration: 1 };
      const flagged = { verdict: "FLAG_FOR_HUMAN", iteration: 0 };
      const ids: string[] = [];
      for (const report of [pass, pass, rewritten, flagged]) {
        const id = await variantWith();
        ids.push(id);
        await t.db
          .update(schema.contentVariants)
          .set({ criticReport: report as never, createdAt: at("2026-10-10T07:00:00Z") })
          .where(eq(schema.contentVariants.id, id));
        await audit(id, "variant.generated", "2026-10-10T08:00:00Z");
      }
      await review(ids[0] as string, "REGENERATE", "2026-10-10T09:00:00Z");
      await review(ids[0] as string, "REGENERATE", "2026-10-10T09:10:00Z");
      const o = await getOperations(fx.ctx, WINDOW);
      expect(o).toMatchObject({ criticReports: 4, criticPassRate: 0.5, generated: 4 });
      expect(o.regenerationsPerVariant).toBe(0.5);
    });

    it("works out the cost of an approved post from every model run of its variant", async () => {
      const a = await variantWith();
      const b = await variantWith();
      const unapproved = await variantWith();
      await review(a, "APPROVE", "2026-10-10T10:00:00Z");
      await review(b, "APPROVE", "2026-10-10T10:00:00Z");
      await run(a, "0.4000");
      await run(a, "0.1000");
      await run(b, "0.3000");
      await run(unapproved, "9.0000");
      const o = await getOperations(fx.ctx, WINDOW);
      expect(o.costPerApprovedPost).toBeCloseTo(0.4, 6); // (0.5 + 0.3) / 2
    });

    it("filters by market and answers with nulls on an empty window", async () => {
      const es = await variantWith("es-ES");
      const en = await variantWith("en");
      await review(es, "APPROVE", "2026-10-10T10:00:00Z");
      await review(en, "REJECT", "2026-10-10T10:00:00Z", { reasonCode: "OTHER" });
      const onlyEs = await getOperations(fx.ctx, { ...WINDOW, marketId: marketIds["es-ES"] ?? "" });
      expect(onlyEs).toMatchObject({ approved: 1, rejected: 0, approvalRate: 1 });
      const empty = await getOperations(fx.ctx, {
        from: "2025-01-01T00:00:00Z",
        to: "2025-02-01T00:00:00Z",
      });
      expect(empty).toMatchObject({
        generated: 0,
        approvalRate: null,
        avgEditsPerApproved: null,
        medianTimeToApproveHours: null,
        criticPassRate: null,
        regenerationsPerVariant: null,
        costPerApprovedPost: null,
        rejectionReasons: [],
      });
    });
  });
});
