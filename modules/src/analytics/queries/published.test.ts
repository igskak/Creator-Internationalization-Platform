import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { NotFoundError } from "@rc/lib/errors";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ReviewFixture, reviewFixture } from "../../content/variants/test-support";
import {
  csvCell,
  exportPublishedCsv,
  getLineage,
  listPublished,
  MAX_CSV_ROWS,
  publishedToCsv,
} from "./index";

// The Published list and the lineage of a post (M6-09) on a fixture with known answers.

const at = (iso: string) => new Date(iso);

describe("published list, CSV and lineage", () => {
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

  async function post(
    opts: {
      market?: "es-ES" | "en";
      publishedAt?: string;
      hook?: string;
      format?: "CAROUSEL" | "REEL";
      sourceVariantId?: string;
      d7?: { reach: number; saves: number; shares?: number };
      dryRun?: boolean;
    } = {},
  ) {
    const { variantId } = await fx.makeVariant({
      status: "PUBLISHED",
      marketCode: opts.market ?? "es-ES",
    });
    await t.db
      .update(schema.contentVariants)
      .set({
        ...(opts.hook ? { hook: opts.hook } : {}),
        ...(opts.format ? { format: opts.format } : {}),
        ...(opts.sourceVariantId ? { sourceVariantId: opts.sourceVariantId } : {}),
        hookType: "MYTH_BUST",
      })
      .where(eq(schema.contentVariants.id, variantId));
    const { versionId } = await fx.makeVersion(variantId);
    const publicationId = await fx.makePublication(variantId, versionId, {
      status: "PUBLISHED",
      mode: "IMMEDIATE",
      dryRun: opts.dryRun ?? false,
      publishedAt: at(opts.publishedAt ?? "2026-10-10T09:00:00Z"),
      permalink: "https://www.instagram.com/p/ABC123/",
      instagramMediaId: `ig-${Math.random().toString(36).slice(2, 10)}`,
    });
    if (opts.d7) {
      await t.db.insert(schema.metricSnapshots).values({
        publicationId,
        snapshotSlot: "D7",
        measuredAt: at("2026-10-20T00:00:00Z"),
        mediaAgeHours: "168",
        reach: opts.d7.reach,
        saves: opts.d7.saves,
        shares: opts.d7.shares ?? 0,
        rawMetricsJson: {},
        apiVersion: "v25.0",
      });
    }
    return { publicationId, variantId, versionId };
  }

  describe("listPublished", () => {
    it("lists posts newest first with their D7 rates, and posts without numbers too", async () => {
      await post({
        publishedAt: "2026-10-05T09:00:00Z",
        hook: "Old",
        d7: { reach: 1000, saves: 100, shares: 20 },
      });
      await post({ publishedAt: "2026-10-12T09:00:00Z", hook: "New" });
      const list = await listPublished(fx.ctx);
      expect(list.total).toBe(2);
      expect(list.rows.map((r) => r.hook)).toEqual(["New", "Old"]);
      expect(list.rows[0]).toMatchObject({ slot: null, reach: null, saveRate: null });
      expect(list.rows[1]).toMatchObject({
        slot: "D7",
        isExactD7: true,
        reach: 1000,
        hookType: "MYTH_BUST",
      });
      expect(list.rows[1]?.saveRate).toBeCloseTo(0.1, 6);
      expect(list.rows[1]?.shareRate).toBeCloseTo(0.02, 6);
      expect(list.rows[1]?.permalink).toContain("instagram.com/p/");
    });

    it("filters by market, format and window, pages, and leaves out dry runs", async () => {
      await post({ market: "es-ES", publishedAt: "2026-10-05T09:00:00Z", hook: "es carousel" });
      await post({ market: "en", publishedAt: "2026-10-06T09:00:00Z", hook: "en carousel" });
      await post({
        market: "en",
        publishedAt: "2026-10-07T09:00:00Z",
        hook: "en reel",
        format: "REEL",
      });
      await post({ market: "en", publishedAt: "2026-10-08T09:00:00Z", hook: "dry", dryRun: true });
      expect((await listPublished(fx.ctx, { market: "en" })).rows.map((r) => r.hook)).toEqual([
        "en reel",
        "en carousel",
      ]);
      expect((await listPublished(fx.ctx, { format: "REEL" })).rows.map((r) => r.hook)).toEqual([
        "en reel",
      ]);
      const window = await listPublished(fx.ctx, {
        from: "2026-10-06T00:00:00Z",
        to: "2026-10-07T00:00:00Z",
      });
      expect(window.rows.map((r) => r.hook)).toEqual(["en carousel"]);
      const first = await listPublished(fx.ctx, { pageSize: 2 });
      const second = await listPublished(fx.ctx, { pageSize: 2, page: 2 });
      expect(first.total).toBe(3);
      expect(first.rows).toHaveLength(2);
      expect(second.rows.map((r) => r.hook)).toEqual(["es carousel"]);
    });
  });

  describe("CSV", () => {
    it("writes a header and one line per post, rates as fractions", async () => {
      await post({ hook: "Bulgur, hot water", d7: { reach: 1000, saves: 100, shares: 20 } });
      const { csv, rows, truncated } = await exportPublishedCsv(fx.ctx);
      expect(rows).toBe(1);
      expect(truncated).toBe(false);
      const [header, line, rest] = csv.split("\r\n");
      expect(header).toBe(
        "published_at,market,format,hook,hook_type,permalink,d7_slot,is_exact_d7,reach,save_rate,share_rate,comment_rate,engagement_rate",
      );
      expect(line).toContain('"Bulgur, hot water"');
      expect(line).toContain(",D7,true,1000,0.1");
      expect(rest).toBe("");
    });

    it("quotes what needs quotes and defuses spreadsheet formulas", () => {
      expect(csvCell('He said "no"')).toBe('"He said ""no"""');
      expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
      expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
      expect(csvCell("+1 trick")).toBe("'+1 trick");
      expect(csvCell("-5 °C")).toBe("'-5 °C");
      expect(csvCell("@sum")).toBe("'@sum");
      // A number is a number, even a negative one; null is an empty cell.
      expect(csvCell(-0.5)).toBe("-0.5");
      expect(csvCell(null)).toBe("");
      expect(csvCell(true)).toBe("true");
    });

    it("is only the header for no rows, and caps the file", async () => {
      expect(publishedToCsv([])).toBe(`${publishedToCsv([]).split("\r\n")[0]}\r\n`);
      expect(MAX_CSV_ROWS).toBe(5000);
    });
  });

  describe("getLineage", () => {
    async function lineageFixture() {
      const { publicationId, variantId } = await post({
        hook: "Lavas el arroz del risotto?",
        d7: { reach: 2000, saves: 150, shares: 40 },
      });
      const [v] = await t.db
        .select()
        .from(schema.contentVariants)
        .where(eq(schema.contentVariants.id, variantId));
      // The source, two cards and their link to the idea.
      const [brand] = await t.db.select().from(schema.brands);
      const [source] = await t.db
        .insert(schema.sourceAssets)
        .values({
          brandId: brand?.id ?? "",
          type: "NOTE",
          title: "Synthetic source",
          originalLanguage: "ru",
          rights: {
            use: "ALLOWED",
            translate: "ALLOWED",
            adapt: "ALLOWED",
            visuallyTransform: "UNKNOWN",
            sell: "UNKNOWN",
            aiProcessing: "ALLOWED",
            improvePrompts: "UNKNOWN",
          },
        })
        .returning();
      const cardIds: string[] = [];
      for (const [i, title] of ["Do not rinse", "Toast the rice"].entries()) {
        const [card] = await t.db
          .insert(schema.knowledgeItems)
          .values({
            brandId: brand?.id ?? "",
            title,
            category: "GRAINS_RICE_PASTA",
            claim: `Claim of ${title}.`,
            language: "en",
            origin: "MANUAL",
            reviewStatus: "CHEF_APPROVED",
            version: 1,
            approvedVersion: 1,
            sourceAssetId: source?.id ?? null,
            sourceReference: { pageStart: 12 + i, quote: `Quote ${i}`, quoteVerified: true },
          })
          .returning();
        cardIds.push(card?.id ?? "");
        await t.db.insert(schema.masterIdeaKnowledge).values({
          masterIdeaId: v?.masterIdeaId ?? "",
          knowledgeItemId: card?.id ?? "",
          knowledgeVersion: 1,
          role: i === 0 ? "PRIMARY" : "SUPPORTING",
        });
      }
      await t.db
        .update(schema.contentVariants)
        .set({
          marketBriefJson: {
            audienceFraming: "Spanish home cooks.",
            terminology: [],
            substitutions: [],
            unitsPolicy: { system: "METRIC", conversions: [] },
            culturalHooks: ["Arroz del domingo"],
            examples: [],
            tone: "Warm.",
            hookType: "MYTH_BUST",
            slidePlan: [],
            ctaApproach: { ctaType: "SAVE" },
            risks: ["Risotto is Italian"],
            differentiationNotes: "Mistake first.",
          },
        })
        .where(eq(schema.contentVariants.id, variantId));
      // Review history and model runs.
      await t.db.insert(schema.reviewEvents).values([
        {
          contentVariantId: variantId,
          action: "EDIT",
          field: "hook",
          variantLockVersion: 0,
          reviewerId: fx.userId,
          createdAt: at("2026-10-09T10:00:00Z"),
        },
        {
          contentVariantId: variantId,
          action: "APPROVE",
          variantLockVersion: 1,
          reviewerId: fx.userId,
          createdAt: at("2026-10-09T11:00:00Z"),
        },
      ]);
      for (const [stage, cost] of [
        ["CONTENT_WRITING", "0.4000"],
        ["CRITIC", "0.1000"],
        ["CRITIC", "0.0500"],
      ] as const) {
        await t.db.insert(schema.generationRuns).values({
          stage,
          promptId: "x",
          promptVersion: 1,
          promptHash: "h",
          provider: "fake",
          model: "fake",
          params: {},
          inputHash: `i-${Math.random()}`,
          status: "SUCCEEDED",
          costUsd: cost,
          contentVariantId: variantId,
        });
      }
      // Two more snapshots on the timeline.
      for (const [slot, age, reach] of [
        ["H2", 2, 120],
        ["D1", 24, 900],
      ] as const) {
        await t.db.insert(schema.metricSnapshots).values({
          publicationId,
          snapshotSlot: slot,
          measuredAt: at("2026-10-11T00:00:00Z"),
          mediaAgeHours: String(age),
          reach,
          saves: 10,
          rawMetricsJson: {},
          apiVersion: "v25.0",
        });
      }
      return { publicationId, variantId, cardIds, ideaId: v?.masterIdeaId ?? "" };
    }

    it("shows the whole chain of a post: source, cards, idea, brief, version, history, cost, numbers", async () => {
      const f = await lineageFixture();
      const lineage = await getLineage(fx.ctx, { publicationId: f.publicationId });
      expect(lineage.publication).toMatchObject({
        id: f.publicationId,
        status: "PUBLISHED",
        permalink: "https://www.instagram.com/p/ABC123/",
        followerCountAtPublish: null,
      });
      expect(lineage.market).toMatchObject({ code: "es-ES", timeZone: "Europe/Madrid" });
      expect(lineage.variant).toMatchObject({
        id: f.variantId,
        format: "CAROUSEL",
        hook: "Lavas el arroz del risotto?",
        hookType: "MYTH_BUST",
        reels: [],
        sourceVariantId: null,
      });
      expect(lineage.idea).toMatchObject({ id: f.ideaId, category: "GRAINS_RICE_PASTA" });
      expect(
        lineage.cards.map((c) => [c.title, c.role, c.sourceTitle, c.sourcePage, c.quote]),
      ).toEqual([
        ["Do not rinse", "PRIMARY", "Synthetic source", 12, "Quote 0"],
        ["Toast the rice", "SUPPORTING", "Synthetic source", 13, "Quote 1"],
      ]);
      expect(lineage.brief).toMatchObject({
        audienceFraming: "Spanish home cooks.",
        risks: ["Risotto is Italian"],
      });
      expect(lineage.version).toMatchObject({ versionNo: 1, approvedBy: "owner@example.com" });
      expect(lineage.version.slideUrls.length).toBeGreaterThan(0);
      expect(lineage.version.videoUrl).toBeNull();
      expect(lineage.reviewHistory.map((e) => [e.action, e.field, e.reviewer])).toEqual([
        ["EDIT", "hook", "owner@example.com"],
        ["APPROVE", null, "owner@example.com"],
      ]);
      expect(lineage.generation).toMatchObject({ runs: 3, costUsd: 0.55 });
      expect(lineage.generation.byStage).toEqual([
        { stage: "CONTENT_WRITING", runs: 1, costUsd: 0.4 },
        { stage: "CRITIC", runs: 2, costUsd: 0.15 },
      ]);
      expect(lineage.metrics.timeline.map((s) => [s.slot, s.ageHours])).toEqual([
        ["H2", 2],
        ["D1", 24],
        ["D7", 168],
      ]);
      expect(lineage.metrics.d7).toMatchObject({
        slot: "D7",
        reach: 2000,
        saves: 150,
        isExactD7: true,
      });
      expect(lineage.metrics.d7?.saveRate).toBeCloseTo(0.075, 6);
    });

    it("has no D7 yet for a young post, but its timeline", async () => {
      const f = await post();
      await t.db.insert(schema.metricSnapshots).values({
        publicationId: f.publicationId,
        snapshotSlot: "H2",
        measuredAt: at("2026-10-10T11:00:00Z"),
        mediaAgeHours: "2",
        reach: 50,
        rawMetricsJson: {},
        apiVersion: "v25.0",
      });
      const lineage = await getLineage(fx.ctx, { publicationId: f.publicationId });
      expect(lineage.metrics.d7).toBeNull();
      expect(lineage.metrics.timeline).toHaveLength(1);
      expect(lineage.cards).toEqual([]);
      expect(lineage.brief).toBeNull();
      expect(lineage.generation).toMatchObject({ runs: 0, costUsd: null });
    });

    it("links a carousel to the Reel made from it, and a Reel to its carousel", async () => {
      const carousel = await post({ hook: "Carousel" });
      const [other] = [
        await post({ hook: "Reel", format: "REEL", sourceVariantId: carousel.variantId }),
      ];
      const a = await getLineage(fx.ctx, { publicationId: carousel.publicationId });
      expect(a.variant.reels).toEqual([{ variantId: other?.variantId, status: "PUBLISHED" }]);
      const b = await getLineage(fx.ctx, { publicationId: other?.publicationId ?? "" });
      expect(b.variant).toMatchObject({ format: "REEL", sourceVariantId: carousel.variantId });
    });

    it("refuses an unknown post and a dry run", async () => {
      await expect(
        getLineage(fx.ctx, { publicationId: "00000000-0000-4000-8000-000000000000" }),
      ).rejects.toBeInstanceOf(NotFoundError);
      const dry = await post({ dryRun: true });
      await expect(getLineage(fx.ctx, { publicationId: dry.publicationId })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });
});
