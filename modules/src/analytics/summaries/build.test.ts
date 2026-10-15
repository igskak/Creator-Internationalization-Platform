import { schema } from "@rc/db";
import type { PerformanceMemory } from "@rc/db/json";
import { PerformanceMemory as PerformanceMemorySchema } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ReviewFixture, reviewFixture } from "../../content/variants/test-support";
import { buildPerformanceSummary, fieldKind, fitSummary, MAX_SUMMARY_CHARS } from "./index";

// The performance memory (M7-02) on fixture history with known answers: patterns and their lift,
// the empty pattern lists below the data threshold, rates relative to each market across markets,
// overused themes, coverage gaps, untested hypotheses, offers and feedback. Synthetic data only.
// The fixture clock is 2026-10-10 12:00 UTC, so a 56-day window runs 2026-08-16 … 2026-10-10.

const at = (iso: string) => new Date(iso);

describe("buildPerformanceSummary", () => {
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

  /** A published post with a D7 snapshot of `saves` per 1,000 reach. */
  async function post(opts: {
    market?: "es-ES" | "en";
    hookType: string;
    saves: number;
    publishedAt?: string;
  }) {
    const { variantId } = await fx.makeVariant({
      status: "PUBLISHED",
      marketCode: opts.market ?? "es-ES",
    });
    await t.db
      .update(schema.contentVariants)
      .set({
        hookType: opts.hookType,
        contentLength: { slides: 6, wordsTotal: 80, captionChars: 300 },
      })
      .where(eq(schema.contentVariants.id, variantId));
    const { versionId } = await fx.makeVersion(variantId);
    const publicationId = await fx.makePublication(variantId, versionId, {
      status: "PUBLISHED",
      mode: "IMMEDIATE",
      publishedAt: at(opts.publishedAt ?? "2026-09-20T09:00:00Z"),
    });
    await t.db.insert(schema.metricSnapshots).values({
      publicationId,
      snapshotSlot: "D7",
      measuredAt: at("2026-09-27T09:00:00Z"),
      mediaAgeHours: "168",
      reach: 1000,
      saves: opts.saves,
      shares: 0,
      rawMetricsJson: {},
      apiVersion: "v25.0",
    });
    return { variantId, publicationId };
  }

  /** Six posts: QUESTION hooks save 40, 50, 60 per 1,000; LIST hooks 10, 20, 20. Median 30. */
  async function sixPosts() {
    for (const saves of [40, 50, 60]) await post({ hookType: "QUESTION", saves });
    for (const saves of [10, 20, 20]) await post({ hookType: "LIST", saves });
  }

  it("finds the strong and the weak hook type with their lift against the market median", async () => {
    await sixPosts();
    const built = await buildPerformanceSummary(fx.ctx, {
      marketId: marketIds["es-ES"] ?? "",
      minPostsForPatterns: 6,
    });
    const m = built.memory;
    expect(m.marketCode).toBe("es-ES");
    expect(m.window).toEqual({ from: "2026-08-16", to: "2026-10-10" });
    expect(m.basis).toEqual({ publications: 6, metric: "D7", minSample: 3 });
    // QUESTION: 40/30, 50/30, 60/30 → median 1.67; LIST: 10/30, 20/30, 20/30 → 0.67.
    expect(m.topPatterns).toEqual([
      {
        dimension: "hook_type",
        value: "QUESTION",
        n: 3,
        metric: "save_rate",
        lift: 1.67,
        confidence: "low",
      },
    ]);
    expect(m.weakPatterns).toEqual([
      {
        dimension: "hook_type",
        value: "LIST",
        n: 3,
        metric: "save_rate",
        lift: 0.67,
        confidence: "low",
      },
    ]);
    // Dimensions with one value are not groups; share rates of 0 give no lift.
    expect(built.stats.groups.map((g) => g.dimension)).toEqual(["hook_type", "hook_type"]);
    expect(built.stats.groups.every((g) => g.shareLift === null)).toBe(true);
    expect(PerformanceMemorySchema.parse(m)).toEqual(m);

    const [row] = await t.db.select().from(schema.performanceSummaries);
    expect(row).toMatchObject({
      id: built.summaryId,
      marketId: marketIds["es-ES"],
      windowStart: "2026-08-16",
      windowEnd: "2026-10-10",
      publicationsCount: 6,
      minSample: 3,
      createdByType: "USER",
    });
  });

  it("leaves the pattern lists empty below the data threshold and says why", async () => {
    await sixPosts();
    const { memory } = await buildPerformanceSummary(fx.ctx, {
      marketId: marketIds["es-ES"] ?? "",
    });
    expect(memory.topPatterns).toEqual([]);
    expect(memory.weakPatterns).toEqual([]);
    expect(memory.caveats[0]).toBe(
      "Only 6 posts have numbers at day 7 (patterns need 20); the pattern lists are left empty.",
    );
    // The rest still works without data: overuse is from approvals, not from numbers.
    expect(memory.overusedThemes[0]).toMatchObject({
      category: "GRAINS_RICE_PASTA",
      count: 6,
      windowDays: 21,
    });
  });

  it("across markets compares each post with its own market, so market size does not make a pattern", async () => {
    // Spain saves 40 per 1,000 with QUESTION hooks, the English market 10 with LIST hooks: raw rates
    // would make QUESTION four times better, but inside each market all posts are alike.
    for (let i = 0; i < 3; i++) await post({ market: "es-ES", hookType: "QUESTION", saves: 40 });
    for (let i = 0; i < 3; i++) await post({ market: "en", hookType: "LIST", saves: 10 });
    const { memory, marketId } = await buildPerformanceSummary(fx.ctx, {
      marketId: null,
      minPostsForPatterns: 6,
    });
    expect(marketId).toBeNull();
    expect(memory.marketCode).toBe("ALL");
    expect(memory.basis.publications).toBe(6);
    expect(memory.topPatterns).toEqual([]);
    expect(memory.weakPatterns).toEqual([]);
    expect(memory.caveats).toContain(
      "Across markets: each post is compared with the median of its own market.",
    );
  });

  it("reports coverage gaps, untested hypotheses, offers and reviewer feedback", async () => {
    const es = marketIds["es-ES"] ?? "";
    const { variantId } = await post({ hookType: "QUESTION", saves: 30 });
    // Five approved cards about sauces and no post about them: a gap. Rice has a post: no gap.
    const [brand] = await t.db.select().from(schema.brands);
    for (const category of ["SAUCES", "GRAINS_RICE_PASTA"]) {
      for (let i = 0; i < 5; i++) {
        await t.db.insert(schema.knowledgeItems).values({
          brandId: brand?.id ?? "",
          title: `${category} ${i}`,
          category,
          claim: "x",
          language: "ru",
          origin: "MANUAL",
          reviewStatus: "CHEF_APPROVED",
        });
      }
    }
    await t.db
      .update(schema.markets)
      .set({
        visualHypotheses: [
          {
            id: "h1",
            description: "Bright daylight photos",
            visualStyle: "BRIGHT",
            status: "UNTESTED",
          },
          { id: "h2", description: "Warm tones", visualStyle: "WARM", status: "CONFIRMED" },
        ],
      })
      .where(eq(schema.markets.id, es));
    await t.db.insert(schema.experiments).values({
      name: "Steam shots",
      hypothesis: "Steam on the cover gets more saves.",
      marketId: es,
      dimension: "visual_style",
      variantA: "WARM",
      variantB: "BRIGHT",
    });
    // An offer with two leads and a sale in the window.
    const offered = await fx.makeVariant({ withOffer: true, commercial: true });
    const [offer] = await t.db
      .select()
      .from(schema.offers)
      .innerJoin(schema.contentVariants, eq(schema.contentVariants.offerId, schema.offers.id))
      .where(eq(schema.contentVariants.id, offered.variantId));
    await t.db
      .update(schema.offers)
      .set({ priority: 7 })
      .where(eq(schema.offers.id, offer?.offers.id ?? ""));
    for (const [type, quantity] of [
      ["LEAD", 2],
      ["SALE", 1],
    ] as const) {
      await t.db.insert(schema.attributionEvents).values({
        marketId: es,
        type,
        quantity,
        occurredAt: at("2026-10-01T10:00:00Z"),
        offerId: offer?.offers.id ?? null,
        source: "MANUAL",
        externalRef: `ref-${type}`,
        ...(type === "SALE" ? { amount: "20.00", currency: "EUR" } : {}),
      });
    }
    // Reviewer feedback in the window.
    const review = (over: Partial<typeof schema.reviewEvents.$inferInsert>) =>
      t.db.insert(schema.reviewEvents).values({
        contentVariantId: variantId,
        variantLockVersion: 0,
        createdAt: at("2026-10-05T10:00:00Z"),
        action: "EDIT",
        ...over,
      });
    await review({ action: "REJECT", reasonCode: "WEAK_HOOK" });
    await review({ action: "REJECT", reasonCode: "WEAK_HOOK" });
    await review({ action: "REQUEST_CHANGES", reasonCode: "TRANSLATIONESE" });
    await review({
      field: "hook",
      originalValue: "¿Lavas el arroz?",
      editedValue: "Nunca laves el arroz del risotto",
    });
    await review({ field: "slides.s1.slots.title", originalValue: "a", editedValue: "b" });
    await review({ field: "slides.s2.slots.title", originalValue: "a", editedValue: "b" });
    await review({ field: "hook", reasonCode: "WEAK_HOOK", createdAt: at("2026-07-01T00:00:00Z") }); // before the window

    const { memory } = await buildPerformanceSummary(fx.ctx, { marketId: es });
    expect(memory.coverageGaps).toEqual([
      { category: "SAUCES", approvedCards: 5, postsLast30d: 0 },
    ]);
    expect(memory.untestedHypotheses).toEqual(
      expect.arrayContaining([
        {
          source: "visual_hypothesis",
          description: "Bright daylight photos (visual style BRIGHT)",
        },
        { source: "experiment", description: "Steam shots: Steam on the cover gets more saves." },
      ]),
    );
    expect(
      memory.untestedHypotheses.some(
        (u) => u.source === "hook_type" && u.description.includes("QUESTION"),
      ),
    ).toBe(false);
    expect(memory.offerPriorities).toEqual([
      {
        offerId: offer?.offers.id,
        productCode: expect.any(String),
        priority: 7,
        leads: 2,
        sales: 1,
      },
    ]);
    expect(memory.feedback).toEqual({
      topRejectionReasons: [
        { code: "WEAK_HOOK", count: 2 },
        { code: "TRANSLATIONESE", count: 1 },
      ],
      mostEditedFields: [
        { field: "slides.slots.title", count: 2 },
        { field: "hook", count: 1 },
      ],
      hookRewrites: [{ original: "¿Lavas el arroz?", edited: "Nunca laves el arroz del risotto" }],
    });
  });
});

describe("summary helpers", () => {
  it("names a field by its kind", () => {
    expect(fieldKind("slides.s3.slots.title")).toBe("slides.slots.title");
    expect(fieldKind("slides.s3")).toBe("slides");
    expect(fieldKind("caption")).toBe("caption");
  });

  it("shortens long lists until the JSON fits, and says so", () => {
    const long = "x".repeat(300);
    const memory: PerformanceMemory = {
      marketCode: "es-ES",
      window: { from: "2026-08-16", to: "2026-10-10" },
      basis: { publications: 50, metric: "D7", minSample: 3 },
      topPatterns: [],
      weakPatterns: [],
      overusedThemes: [],
      coverageGaps: [],
      untestedHypotheses: Array.from({ length: 15 }, () => ({
        source: "experiment" as const,
        description: long,
      })),
      offerPriorities: [],
      feedback: {
        topRejectionReasons: [],
        mostEditedFields: [],
        hookRewrites: Array.from({ length: 5 }, () => ({ original: long, edited: long })),
      },
      caveats: [],
    };
    const fitted = fitSummary(memory);
    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
    expect(fitted.caveats).toContain("Some lists were shortened to keep the summary short.");
    expect(memory.untestedHypotheses).toHaveLength(15); // the input is not changed
    expect(
      fitSummary({
        ...memory,
        untestedHypotheses: [],
        feedback: { ...memory.feedback, hookRewrites: [] },
      }).caveats,
    ).toEqual([]);
  });
});
