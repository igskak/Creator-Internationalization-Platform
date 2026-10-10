import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getWorkQueue, listDrafts } from "./queries";
import { type ReviewFixture, reviewFixture } from "./test-support";

// The draft queue and the work-queue counters (M4-07), over fixture data.

describe("draft queue and counters", () => {
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

  /** One variant per status/market pair; `at` orders them by update time. */
  const make = async (
    status: Parameters<ReviewFixture["makeVariant"]>[0] extends infer O
      ? O extends { status?: infer S }
        ? S
        : never
      : never,
    marketCode: string,
    over: { flags?: string[]; at?: string; score?: string } = {},
  ) => {
    const made = await fx.makeVariant({
      status,
      marketCode,
      flags: over.flags ?? [],
      ...(over.at ? { updatedAt: new Date(over.at) } : {}),
      ...(over.score ? { qualityScore: over.score } : {}),
    });
    return made.variantId;
  };

  it("groups statuses into tabs, newest change first, and counts every tab", async () => {
    const old = await make("READY_FOR_REVIEW", "es-ES", { at: "2026-10-01T10:00:00Z" });
    const recent = await make("CHANGES_REQUESTED", "en", {
      at: "2026-10-05T10:00:00Z",
      score: "4.30",
    });
    await make("DRAFT", "fr-FR", { at: "2026-10-03T10:00:00Z" });
    await make("APPROVED", "es-ES");
    await make("SCHEDULED", "en");
    await make("PUBLISHING", "fr-FR");
    await make("PUBLISHED", "es-ES");
    await make("FAILED", "en");
    await make("REJECTED", "fr-FR");

    const review = await listDrafts(fx.ctx);
    expect(review.rows.map((r) => r.variantId)).toEqual([
      recent,
      (
        await t.db
          .select()
          .from(schema.contentVariants)
          .where(eq(schema.contentVariants.status, "DRAFT"))
      )[0]?.id,
      old,
    ]);
    expect(review.total).toBe(3);
    expect(review.tabCounts).toEqual({
      REVIEW: 3,
      APPROVED: 1,
      SCHEDULED: 2,
      PUBLISHED: 1,
      FAILED: 1,
      REJECTED: 1,
    });
    expect(review.rows[0]).toMatchObject({
      marketCode: "en",
      marketName: "English",
      flagEmoji: "🌐",
      status: "CHANGES_REQUESTED",
      qualityScore: 4.3,
      ideaTopic: "Rice",
    });
    expect(
      (await listDrafts(fx.ctx, { tab: "SCHEDULED" })).rows.map((r) => r.status).sort(),
    ).toEqual(["PUBLISHING", "SCHEDULED"]);
    expect((await listDrafts(fx.ctx, { tab: "FAILED" })).total).toBe(1);
  });

  it("filters by market and by flags, and the tab counts follow the filters", async () => {
    await make("READY_FOR_REVIEW", "es-ES", { flags: ["SAFETY_REVIEW"] });
    await make("READY_FOR_REVIEW", "es-ES");
    await make("READY_FOR_REVIEW", "en", { flags: ["DUPLICATION_RISK", "SAFETY_REVIEW"] });
    await make("APPROVED", "es-ES", { flags: ["KNOWLEDGE_CHANGED"] });

    const es = await listDrafts(fx.ctx, { market: "es-ES" });
    expect(es.total).toBe(2);
    expect(es.tabCounts.REVIEW).toBe(2);
    const flagged = await listDrafts(fx.ctx, { flagged: true });
    expect(flagged.rows.map((r) => r.marketCode).sort()).toEqual(["en", "es-ES"]);
    expect(flagged.tabCounts).toMatchObject({ REVIEW: 2, APPROVED: 1 });
    expect(flagged.rows.find((r) => r.marketCode === "en")?.flags).toEqual([
      "DUPLICATION_RISK",
      "SAFETY_REVIEW",
    ]);
    const both = await listDrafts(fx.ctx, { market: "es-ES", flagged: true, tab: "APPROVED" });
    expect(both.rows).toHaveLength(1);
    expect((await listDrafts(fx.ctx, { market: "fr-FR" })).total).toBe(0);
  });

  it("pages the list", async () => {
    for (let i = 0; i < 5; i++) {
      await make("READY_FOR_REVIEW", "es-ES", { at: `2026-10-0${i + 1}T10:00:00Z` });
    }
    const first = await listDrafts(fx.ctx, { pageSize: 2 });
    const second = await listDrafts(fx.ctx, { pageSize: 2, page: 2 });
    const third = await listDrafts(fx.ctx, { pageSize: 2, page: 3 });
    expect([first.rows.length, second.rows.length, third.rows.length]).toEqual([2, 2, 1]);
    expect(first.total).toBe(5);
    expect(
      new Set([...first.rows, ...second.rows, ...third.rows].map((r) => r.variantId)).size,
    ).toBe(5);
    expect(first.rows[0]?.updatedAt.toISOString()).toBe("2026-10-05T10:00:00.000Z");
  });

  it("names the last person who touched a draft", async () => {
    const id = await make("READY_FOR_REVIEW", "es-ES");
    const lonely = await make("READY_FOR_REVIEW", "en");
    await t.db
      .update(schema.appUsers)
      .set({ displayName: "Sergey" })
      .where(eq(schema.appUsers.id, fx.userId));
    await t.db.insert(schema.reviewEvents).values([
      { contentVariantId: id, action: "EDIT", reviewerId: fx.userId, variantLockVersion: 0 },
      { contentVariantId: id, action: "COMMENT", reviewerId: null, variantLockVersion: 1 },
    ]);
    const rows = (await listDrafts(fx.ctx)).rows;
    expect(rows.find((r) => r.variantId === id)?.reviewer).toBe("Sergey");
    expect(rows.find((r) => r.variantId === lonely)?.reviewer).toBeNull();
  });

  it("counts what waits for a person", async () => {
    // Empty database: zeros.
    expect(await getWorkQueue(fx.ctx)).toEqual({
      cardsToReview: 0,
      ideasProposed: 0,
      draftsReady: 0,
      changesRequested: 0,
      approvedNotScheduled: 0,
      scheduledNext7Days: 0,
      failed: 0,
    });

    const [brand] = await t.db.select().from(schema.brands);
    await t.db.insert(schema.knowledgeItems).values(
      [1, 2, 3].map((n) => ({
        brandId: brand?.id ?? "",
        title: `Card ${n}`,
        category: "GRAINS_RICE_PASTA",
        claim: "c",
        language: "ru",
        origin: "SOURCE_EXTRACTED" as const,
        reviewStatus: n === 3 ? ("CHEF_APPROVED" as const) : ("NEEDS_REVIEW" as const),
      })),
    );
    await t.db.insert(schema.masterIdeas).values(
      ["PROPOSED", "PROPOSED", "ACCEPTED"].map((status, i) => ({
        brandId: brand?.id ?? "",
        topic: `Idea ${i}`,
        category: "GRAINS_RICE_PASTA",
        angle: "COMMON_MISTAKE",
        coreMessage: "m",
        origin: "MANUAL" as const,
        status: status as "PROPOSED" | "ACCEPTED",
      })),
    );
    await make("READY_FOR_REVIEW", "es-ES");
    await make("READY_FOR_REVIEW", "en");
    await make("CHANGES_REQUESTED", "fr-FR");
    const approved = await make("APPROVED", "es-ES");
    const scheduled = await make("SCHEDULED", "en");
    const later = await make("SCHEDULED", "fr-FR");
    await make("FAILED", "es-ES");

    const now = fx.clock.now().getTime();
    const day = 24 * 60 * 60 * 1000;
    const { versionId } = await fx.makeVersion(scheduled);
    await fx.makePublication(scheduled, versionId, { scheduledAt: new Date(now + 2 * day) });
    const laterVersion = await fx.makeVersion(later);
    await fx.makePublication(later, laterVersion.versionId, {
      scheduledAt: new Date(now + 9 * day),
    });
    const approvedVersion = await fx.makeVersion(approved);
    // A cancelled one and a dry run do not count.
    await fx.makePublication(approved, approvedVersion.versionId, {
      status: "CANCELLED",
      scheduledAt: new Date(now + day),
    });
    await fx.makePublication(approved, approvedVersion.versionId, {
      dryRun: true,
      status: "DRY_RUN_PASSED",
      scheduledAt: new Date(now + day),
    });

    expect(await getWorkQueue(fx.ctx)).toEqual({
      cardsToReview: 2,
      ideasProposed: 2,
      draftsReady: 2,
      changesRequested: 1,
      approvedNotScheduled: 1,
      scheduledNext7Days: 1,
      failed: 1,
    });
  });
});
