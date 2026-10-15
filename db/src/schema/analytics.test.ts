import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../test-db";
import {
  accountMetricSnapshots,
  attributionEvents,
  metricSnapshots,
  type SNAPSHOT_SLOTS,
} from "./analytics";
import {
  carouselRenders,
  contentVariants,
  contentVariantVersions,
  masterIdeas,
  offers,
  products,
} from "./content";
import { appUsers, brands, markets } from "./core";
import { publications, socialAccounts } from "./publishing";

// 0011_analytics: the tables, and the three views on fixture data with known answers (plan 11
// §11.3): the D7 choice and its fallback, the dayparts in the market's time zone, campaign sums.
// Synthetic data only.

type Slot = (typeof SNAPSHOT_SLOTS)[number];

describe("0011_analytics", () => {
  let t: TestDb;
  let brandId: string;
  let userId: string;
  const marketIds: Record<string, string> = {};

  const market = async (code: string, timezone: string) => {
    const [row] = await t.db
      .insert(markets)
      .values({
        brandId,
        code,
        displayName: code,
        country: code === "es-ES" ? "ES" : "US",
        language: code === "es-ES" ? "es" : "en",
        timezone,
        currency: code === "es-ES" ? "EUR" : "USD",
        measurementSystem: "METRIC",
      })
      .returning();
    marketIds[code] = row?.id ?? "";
  };

  let n = 0;
  /** A published post of the market at `publishedAt`, with the variant's dimensions. */
  const post = async (
    code: string,
    publishedAt: string,
    over: {
      status?: "PUBLISHED" | "DRY_RUN_PASSED";
      dryRun?: boolean;
      hookType?: string;
      campaignId?: string;
      offerId?: string;
      format?: "CAROUSEL" | "REEL";
    } = {},
  ) => {
    n += 1;
    const marketId = marketIds[code] ?? "";
    // The live slot of an idea, market and format is unique: every post gets an idea of its own.
    const [idea] = await t.db
      .insert(masterIdeas)
      .values({
        brandId,
        topic: `Idea ${n}`,
        category: "GRAINS_RICE_PASTA",
        angle: "COMMON_MISTAKE",
        coreMessage: "Synthetic core message",
        origin: "MANUAL",
      })
      .returning();
    const [variant] = await t.db
      .insert(contentVariants)
      .values({
        masterIdeaId: idea?.id ?? "",
        marketId,
        format: over.format ?? "CAROUSEL",
        hookType: over.hookType ?? "QUESTION",
        visualStyle: "WARM",
        ctaType: "SAVE",
        templateSequence: ["A", "B", "F"],
        contentLength: { slides: 6, wordsTotal: 80, captionChars: 300 },
        generationVersion: "p1.7.0",
        ...(over.campaignId ? { campaignId: over.campaignId } : {}),
        ...(over.offerId ? { offerId: over.offerId } : {}),
      })
      .returning();
    const [render] = await t.db
      .insert(carouselRenders)
      .values({ contentVariantId: variant?.id ?? "", inputHash: `h${n}`, templatesVersion: "t1" })
      .returning();
    const [version] = await t.db
      .insert(contentVariantVersions)
      .values({
        contentVariantId: variant?.id ?? "",
        versionNo: 1,
        snapshot: {
          hook: "Hook",
          hookType: "QUESTION",
          caption: "Caption",
          cta: { type: "SAVE", text: "Save it" },
          hashtags: [],
          slides: [],
          visualStyle: "WARM",
          templateSequence: [],
          renderId: render?.id ?? "",
          renderedSlideKeys: [],
          knowledge: [],
          generationVersion: "p1.7.0",
        },
        carouselRenderId: render?.id ?? "",
        contentHash: `x${n}`,
        approvedBy: userId,
      })
      .returning();
    const [pub] = await t.db
      .insert(publications)
      .values({
        contentVariantId: variant?.id ?? "",
        contentVariantVersionId: version?.id ?? "",
        marketId,
        mode: "IMMEDIATE",
        status: over.status ?? "PUBLISHED",
        dryRun: over.dryRun ?? false,
        publishedAt: new Date(publishedAt),
        followerCountAtPublish: 1200,
        idempotencyKey: `pub:analytics:${n}`,
      })
      .returning();
    return { publicationId: pub?.id ?? "", variantId: variant?.id ?? "" };
  };

  const snapshot = (
    publicationId: string,
    slot: Slot,
    ageHours: number,
    values: Partial<typeof metricSnapshots.$inferInsert> = {},
  ) =>
    t.db.insert(metricSnapshots).values({
      publicationId,
      snapshotSlot: slot,
      measuredAt: new Date("2026-11-01T00:00:00Z"),
      mediaAgeHours: String(ageHours),
      rawMetricsJson: {},
      apiVersion: "v25.0",
      ...values,
    });

  beforeAll(async () => {
    t = await createTestDb();
    const [brand] = await t.db.insert(brands).values({ slug: "an-brand", name: "A" }).returning();
    brandId = brand?.id ?? "";
    await market("es-ES", "Europe/Madrid");
    await market("en", "America/New_York");
    const [user] = await t.db
      .insert(appUsers)
      .values({ email: "analyst@example.test", role: "editor" })
      .returning();
    userId = user?.id ?? "";
  });
  afterAll(async () => {
    await t.close();
  });

  const viewRow = async <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
    (await t.db.execute<T>(query)).rows[0];

  it("enables RLS on the three new tables", async () => {
    const names = ["metric_snapshots", "account_metric_snapshots", "attribution_events"];
    const result = await t.db.execute<{ relrowsecurity: boolean }>(sql`
      select relrowsecurity from pg_class
      where relname in (${sql.join(
        names.map((x) => sql`${x}`),
        sql`, `,
      )})`);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  describe("metric_snapshots", () => {
    it("keeps one snapshot per slot and post, but any number of manual ones", async () => {
      const { publicationId } = await post("es-ES", "2026-10-01T09:00:00Z");
      await snapshot(publicationId, "D1", 24);
      await expect(snapshot(publicationId, "D1", 25)).rejects.toThrow();
      await snapshot(publicationId, "MANUAL", 30);
      await snapshot(publicationId, "MANUAL", 31);
      const rows = await t.db
        .select()
        .from(metricSnapshots)
        .where(eq(metricSnapshots.publicationId, publicationId));
      expect(rows).toHaveLength(3);
    });

    it("stores a metric Instagram did not report as null, not 0", async () => {
      const { publicationId } = await post("es-ES", "2026-10-02T09:00:00Z");
      await snapshot(publicationId, "H2", 2, { reach: 120, saves: null });
      const [row] = await t.db
        .select()
        .from(metricSnapshots)
        .where(eq(metricSnapshots.publicationId, publicationId));
      expect(row).toMatchObject({ reach: 120, saves: null, shares: null, views: null });
    });

    it("refuses a negative age", async () => {
      const { publicationId } = await post("es-ES", "2026-10-03T09:00:00Z");
      await expect(snapshot(publicationId, "H2", -1)).rejects.toThrow();
    });
  });

  describe("v_publication_metrics_d7", () => {
    const d7 = (publicationId: string) =>
      viewRow<{
        snapshot_slot: Slot;
        media_age_hours: string;
        reach: number;
        save_rate: string | null;
        engagement_rate: string | null;
        is_exact_d7: boolean;
      }>(sql`select * from v_publication_metrics_d7 where publication_id = ${publicationId}`);

    it("takes the D7 snapshot when there is one, even when a D28 exists", async () => {
      const { publicationId } = await post("es-ES", "2026-10-04T09:00:00Z");
      await snapshot(publicationId, "H2", 2, { reach: 10 });
      await snapshot(publicationId, "D3", 72, { reach: 300 });
      await snapshot(publicationId, "D7", 168, { reach: 500, saves: 50, shares: 25, comments: 5 });
      await snapshot(publicationId, "D28", 672, { reach: 900 });
      const row = await d7(publicationId);
      expect(row).toMatchObject({ snapshot_slot: "D7", reach: 500, is_exact_d7: true });
      expect(Number(row?.save_rate)).toBeCloseTo(0.1, 6);
    });

    it("falls back to D3 for a post that is not a week old yet, and says it is not exact", async () => {
      const { publicationId } = await post("es-ES", "2026-10-05T09:00:00Z");
      await snapshot(publicationId, "H2", 2, { reach: 10 });
      await snapshot(publicationId, "D1", 24, { reach: 100 });
      await snapshot(publicationId, "D3", 72, { reach: 300 });
      expect(await d7(publicationId)).toMatchObject({
        snapshot_slot: "D3",
        reach: 300,
        is_exact_d7: false,
      });
    });

    it("uses the age, not the slot name: a late D7 stored at 190 h still wins over a D3", async () => {
      const { publicationId } = await post("es-ES", "2026-10-06T09:00:00Z");
      await snapshot(publicationId, "D3", 75, { reach: 300 });
      await snapshot(publicationId, "D7", 190, { reach: 480 });
      expect(await d7(publicationId)).toMatchObject({ snapshot_slot: "D7", reach: 480 });
    });

    it("leaves a post out while its newest snapshot is under 72 hours old", async () => {
      const { publicationId } = await post("es-ES", "2026-10-07T09:00:00Z");
      await snapshot(publicationId, "D1", 24, { reach: 100 });
      expect(await d7(publicationId)).toBeUndefined();
    });

    it("gives null rates, not 0 or a division error, when there is no reach", async () => {
      const { publicationId } = await post("es-ES", "2026-10-08T09:00:00Z");
      await snapshot(publicationId, "D7", 168, { reach: 0, saves: 4 });
      const noReach = await d7(publicationId);
      expect(noReach).toMatchObject({ reach: 0, save_rate: null, engagement_rate: null });
      const second = await post("es-ES", "2026-10-09T09:00:00Z");
      await snapshot(second.publicationId, "D7", 168, { reach: null, saves: 4 });
      expect((await d7(second.publicationId))?.save_rate).toBeNull();
    });

    it("computes the engagement rate from total interactions, else from its parts", async () => {
      const a = await post("es-ES", "2026-10-10T09:00:00Z");
      await snapshot(a.publicationId, "D7", 168, {
        reach: 1000,
        totalInteractions: 120,
        likes: 90,
        comments: 5,
        saves: 20,
        shares: 5,
      });
      expect(Number((await d7(a.publicationId))?.engagement_rate)).toBeCloseTo(0.12, 6);
      const b = await post("es-ES", "2026-10-11T09:00:00Z");
      await snapshot(b.publicationId, "D7", 168, {
        reach: 1000,
        likes: 90,
        comments: 5,
        saves: 20,
        shares: 5,
      });
      expect(Number((await d7(b.publicationId))?.engagement_rate)).toBeCloseTo(0.12, 6);
    });
  });

  describe("v_publication_dimensions", () => {
    const dims = (publicationId: string) =>
      viewRow<{
        market_code: string;
        weekday_local: number;
        daypart_local: string;
        hook_type: string;
        format: string;
        first_template_id: string;
        slide_count: number;
        caption_chars: number;
        follower_count_at_publish: number;
      }>(sql`select * from v_publication_dimensions where publication_id = ${publicationId}`);

    it("reads the daypart and the weekday in the market's time zone, not in UTC", async () => {
      // 2026-10-14 is a Wednesday. 22:30 UTC is 00:30 on Thursday in Madrid (UTC+2): NIGHT, 4;
      // in New York (UTC-4) it is 18:30 on Wednesday: EVENING, 3.
      const es = await post("es-ES", "2026-10-14T22:30:00Z");
      const us = await post("en", "2026-10-14T22:30:00Z");
      expect(await dims(es.publicationId)).toMatchObject({
        market_code: "es-ES",
        weekday_local: 4,
        daypart_local: "NIGHT",
      });
      expect(await dims(us.publicationId)).toMatchObject({
        market_code: "en",
        weekday_local: 3,
        daypart_local: "EVENING",
      });
    });

    it("cuts the dayparts at 6, 11, 15 and 18 o'clock local time", async () => {
      // Madrid is UTC+2 in October: local hour = UTC hour + 2.
      const cases: [string, string][] = [
        ["2026-10-14T03:59:00Z", "NIGHT"], // 05:59
        ["2026-10-14T04:00:00Z", "MORNING"], // 06:00
        ["2026-10-14T08:59:00Z", "MORNING"], // 10:59
        ["2026-10-14T09:00:00Z", "MIDDAY"], // 11:00
        ["2026-10-14T12:59:00Z", "MIDDAY"], // 14:59
        ["2026-10-14T13:00:00Z", "AFTERNOON"], // 15:00
        ["2026-10-14T15:59:00Z", "AFTERNOON"], // 17:59
        ["2026-10-14T16:00:00Z", "EVENING"], // 18:00
        ["2026-10-14T19:59:00Z", "EVENING"], // 21:59
        ["2026-10-14T20:00:00Z", "NIGHT"], // 22:00
      ];
      for (const [at, expected] of cases) {
        const p = await post("es-ES", at);
        expect((await dims(p.publicationId))?.daypart_local, at).toBe(expected);
      }
    });

    it("carries the content dimensions of the variant, for a carousel and for a Reel", async () => {
      const carousel = await post("es-ES", "2026-10-15T10:00:00Z", { hookType: "MYTH_BUST" });
      expect(await dims(carousel.publicationId)).toMatchObject({
        hook_type: "MYTH_BUST",
        format: "CAROUSEL",
        first_template_id: "A",
        slide_count: 6,
        caption_chars: 300,
        follower_count_at_publish: 1200,
      });
      const reel = await post("es-ES", "2026-10-15T11:00:00Z", { format: "REEL" });
      expect((await dims(reel.publicationId))?.format).toBe("REEL");
    });

    it("leaves out dry runs and posts that are not published", async () => {
      const dry = await post("es-ES", "2026-10-16T10:00:00Z", {
        status: "DRY_RUN_PASSED",
        dryRun: true,
      });
      expect(await dims(dry.publicationId)).toBeUndefined();
      const failed = await post("es-ES", "2026-10-16T11:00:00Z");
      await t.db
        .update(publications)
        .set({ status: "FAILED" })
        .where(eq(publications.id, failed.publicationId));
      expect(await dims(failed.publicationId)).toBeUndefined();
    });
  });

  describe("v_campaign_attribution", () => {
    let offerId: string;
    beforeAll(async () => {
      const [product] = await t.db
        .insert(products)
        .values({ brandId, code: "guide-an", name: "Guide", type: "GUIDE", originalLanguage: "ru" })
        .returning();
      const [offer] = await t.db
        .insert(offers)
        .values({
          marketId: marketIds["es-ES"] ?? "",
          productId: product?.id ?? "",
          name: "Guide",
          type: "LEAD_MAGNET",
          currency: "EUR",
          landingUrl: "https://example.test/guide",
          defaultKeyword: "GUIDE",
          status: "ACTIVE",
        })
        .returning();
      offerId = offer?.id ?? "";
    });

    const event = (
      type: "LEAD" | "SALE" | "REFUND",
      campaignId: string,
      over: Partial<typeof attributionEvents.$inferInsert> = {},
    ) =>
      t.db.insert(attributionEvents).values({
        marketId: marketIds["es-ES"] ?? "",
        type,
        occurredAt: new Date("2026-10-20T10:00:00Z"),
        campaignId,
        source: "MANUAL",
        ...over,
      });

    it("sums leads, sales and revenue per campaign, refunds taken off", async () => {
      await post("es-ES", "2026-10-17T10:00:00Z", { campaignId: "rc-es-261017-aaaaaa", offerId });
      await post("es-ES", "2026-10-17T11:00:00Z", { campaignId: "rc-es-261017-bbbbbb", offerId });
      await event("LEAD", "rc-es-261017-aaaaaa");
      await event("LEAD", "rc-es-261017-aaaaaa", { quantity: 3 });
      await event("SALE", "rc-es-261017-aaaaaa", { amount: "49.00", currency: "EUR" });
      await event("SALE", "rc-es-261017-aaaaaa", { amount: "29.50", currency: "EUR" });
      await event("REFUND", "rc-es-261017-aaaaaa", { amount: "29.50", currency: "EUR" });
      await event("LEAD", "rc-es-261017-bbbbbb");
      const a = await viewRow<{ leads: number; sales: number; revenue: string; offer_id: string }>(
        sql`select * from v_campaign_attribution where campaign_id = 'rc-es-261017-aaaaaa'`,
      );
      expect(a).toMatchObject({ leads: 4, sales: 2, offer_id: offerId });
      expect(Number(a?.revenue)).toBeCloseTo(49, 2);
      const b = await viewRow<{ leads: number; sales: number; revenue: string }>(
        sql`select * from v_campaign_attribution where campaign_id = 'rc-es-261017-bbbbbb'`,
      );
      expect(b).toMatchObject({ leads: 1, sales: 0 });
      expect(Number(b?.revenue)).toBe(0);
    });

    it("shows a campaign with no events as zeros, and keeps unknown campaign ids out", async () => {
      await post("es-ES", "2026-10-18T10:00:00Z", { campaignId: "rc-es-261018-cccccc" });
      await event("LEAD", "rc-es-unknown-zzzzzz");
      const quiet = await viewRow<{ leads: number; sales: number; revenue: string }>(
        sql`select * from v_campaign_attribution where campaign_id = 'rc-es-261018-cccccc'`,
      );
      expect(quiet).toMatchObject({ leads: 0, sales: 0 });
      expect(
        await viewRow(
          sql`select * from v_campaign_attribution where campaign_id = 'rc-es-unknown-zzzzzz'`,
        ),
      ).toBeUndefined();
    });

    it("dedupes an imported event by source and external reference, and checks the currency code", async () => {
      await event("SALE", "rc-es-261017-aaaaaa", {
        source: "CSV_IMPORT",
        externalRef: "order-1",
        amount: "10.00",
        currency: "EUR",
      });
      await expect(
        event("SALE", "rc-es-261017-aaaaaa", {
          source: "CSV_IMPORT",
          externalRef: "order-1",
          amount: "10.00",
          currency: "EUR",
        }),
      ).rejects.toThrow();
      // The same reference from another source is another event.
      await event("SALE", "rc-es-261017-aaaaaa", {
        source: "WEBHOOK",
        externalRef: "order-1",
        amount: "10.00",
        currency: "EUR",
      });
      await expect(event("SALE", "x", { currency: "eur" })).rejects.toThrow();
      await expect(event("LEAD", "x", { quantity: 0 })).rejects.toThrow();
    });
  });

  describe("account_metric_snapshots", () => {
    it("keeps one row per account and market-local day", async () => {
      const [account] = await t.db
        .insert(socialAccounts)
        .values({
          marketId: marketIds["es-ES"] ?? "",
          username: "an_es",
          instagramAccountId: "9001",
          accessTokenEncrypted: "enc:v1:test",
        })
        .returning();
      const row = (day: string) =>
        t.db.insert(accountMetricSnapshots).values({
          socialAccountId: account?.id ?? "",
          metricDate: day,
          measuredAt: new Date("2026-11-02T02:17:00Z"),
          followersCount: 1500,
          reach: null,
          raw: {},
          apiVersion: "v25.0",
        });
      await row("2026-11-01");
      await expect(row("2026-11-01")).rejects.toThrow();
      await row("2026-11-02");
      const rows = await t.db.select().from(accountMetricSnapshots);
      expect(rows.map((r) => r.metricDate).sort()).toEqual(["2026-11-01", "2026-11-02"]);
      expect(rows.every((r) => r.reach === null)).toBe(true);
    });
  });
});
