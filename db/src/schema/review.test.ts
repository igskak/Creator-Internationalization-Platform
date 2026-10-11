import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../test-db";
import {
  carouselRenders,
  contentVariants,
  contentVariantVersions,
  masterIdeas,
  reviewEvents,
  voiceExamples,
} from "./content";
import { appUsers, brands, markets } from "./core";
import { integrationEvents, publications, publishAttempts, socialAccounts } from "./publishing";

// Synthetic data only.
describe("0006_review_scheduling", () => {
  let t: TestDb;
  let brandId: string;
  let marketId: string;
  let ideaId: string;
  let userId: string;
  let variantId: string;
  let renderId: string;

  const newVariant = async (marketCode = "es-ES") => {
    let id = marketId;
    if (marketCode !== "es-ES") {
      const [m] = await t.db
        .insert(markets)
        .values({
          brandId,
          code: marketCode,
          displayName: marketCode,
          country: "GB",
          language: "en",
          timezone: "Europe/London",
          currency: "GBP",
          measurementSystem: "METRIC",
        })
        .returning();
      id = m?.id ?? "";
    }
    const [variant] = await t.db
      .insert(contentVariants)
      .values({ masterIdeaId: ideaId, marketId: id })
      .returning();
    const [render] = await t.db
      .insert(carouselRenders)
      .values({
        contentVariantId: variant?.id ?? "",
        inputHash: `h-${variant?.id}`,
        templatesVersion: "t1",
      })
      .returning();
    return { variantId: variant?.id ?? "", renderId: render?.id ?? "", marketId: id };
  };

  const newVersion = async (variant: { variantId: string; renderId: string }, versionNo = 1) => {
    const [version] = await t.db
      .insert(contentVariantVersions)
      .values({
        contentVariantId: variant.variantId,
        versionNo,
        snapshot: {
          hook: "Hook",
          hookType: "QUESTION",
          caption: "Caption",
          cta: { type: "SAVE", text: "Save it" },
          hashtags: [],
          slides: [],
          visualStyle: "WARM",
          templateSequence: [],
          renderId: variant.renderId,
          renderedSlideKeys: [],
          knowledge: [],
          generationVersion: "1.2.0",
        },
        carouselRenderId: variant.renderId,
        contentHash: "hash",
        approvedBy: userId,
      })
      .returning();
    return version?.id ?? "";
  };

  const newPublication = (
    v: { variantId: string; marketId: string },
    versionId: string,
    key: string,
    over: Partial<typeof publications.$inferInsert> = {},
  ) =>
    t.db
      .insert(publications)
      .values({
        contentVariantId: v.variantId,
        contentVariantVersionId: versionId,
        marketId: v.marketId,
        mode: "SCHEDULED",
        scheduledAt: new Date("2026-12-01T10:00:00Z"),
        status: "SCHEDULED",
        idempotencyKey: key,
        ...over,
      })
      .returning();

  beforeAll(async () => {
    t = await createTestDb();
    const [brand] = await t.db.insert(brands).values({ slug: "rv-brand", name: "R" }).returning();
    brandId = brand?.id ?? "";
    const [market] = await t.db
      .insert(markets)
      .values({
        brandId,
        code: "es-ES",
        displayName: "Spain",
        country: "ES",
        language: "es",
        timezone: "Europe/Madrid",
        currency: "EUR",
        measurementSystem: "METRIC",
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
    const [user] = await t.db
      .insert(appUsers)
      .values({ email: "reviewer@example.test", role: "editor" })
      .returning();
    userId = user?.id ?? "";
    const first = await newVariant();
    variantId = first.variantId;
    renderId = first.renderId;
  });

  afterAll(async () => {
    await t.close();
  });

  it("enables RLS on every review and scheduling table", async () => {
    const names = ["review_events", "content_variant_versions", "social_accounts", "publications"];
    const result = await t.db.execute<{ relrowsecurity: boolean }>(sql`
      select relrowsecurity from pg_class
      where relname in (${sql.join(
        names.map((n) => sql`${n}`),
        sql`, `,
      )})`);
    expect(result.rows).toHaveLength(names.length);
    expect(result.rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it("stores a review event with structured before and after values", async () => {
    const slide = { id: "s1", slots: { headline: "Old" } };
    const [event] = await t.db
      .insert(reviewEvents)
      .values({
        contentVariantId: variantId,
        action: "EDIT",
        field: "slides.s1",
        originalValue: slide,
        editedValue: { ...slide, slots: { headline: "New" } },
        reviewerId: userId,
        reasonCode: "TOO_LONG",
        variantLockVersion: 3,
      })
      .returning();
    expect(event).toMatchObject({
      action: "EDIT",
      field: "slides.s1",
      originalValue: slide,
      variantLockVersion: 3,
    });
    expect(event?.createdAt).toBeInstanceOf(Date);
  });

  it("rejects an unknown review action and a missing lock version", async () => {
    await expect(
      t.db.insert(reviewEvents).values({
        contentVariantId: variantId,
        action: "DELETE" as "EDIT",
        variantLockVersion: 0,
      }),
    ).rejects.toThrow();
    await expect(
      t.db.insert(reviewEvents).values({
        contentVariantId: variantId,
        action: "COMMENT",
      } as typeof reviewEvents.$inferInsert),
    ).rejects.toThrow();
  });

  it("lets a voice example point at the review event it came from", async () => {
    const [event] = await t.db
      .insert(reviewEvents)
      .values({ contentVariantId: variantId, action: "EDIT", variantLockVersion: 1 })
      .returning();
    const [example] = await t.db
      .insert(voiceExamples)
      .values({
        kind: "EDIT_PAIR",
        beforeText: "before",
        afterText: "after",
        source: "REVIEW_EVENT",
        reviewEventId: event?.id ?? "",
      })
      .returning();
    expect(example?.reviewEventId).toBe(event?.id);
    await expect(
      t.db.insert(voiceExamples).values({
        kind: "EDIT_PAIR",
        source: "REVIEW_EVENT",
        reviewEventId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toThrow();
  });

  it("numbers approved versions per variant and points the variant at one", async () => {
    const versionId = await newVersion({ variantId, renderId }, 1);
    await expect(newVersion({ variantId, renderId }, 1)).rejects.toThrow();
    const second = await newVersion({ variantId, renderId }, 2);
    const [variant] = await t.db
      .update(contentVariants)
      .set({ approvedVersionId: second })
      .where(eq(contentVariants.id, variantId))
      .returning();
    expect(variant?.approvedVersionId).toBe(second);
    expect(versionId).not.toBe(second);
    await expect(
      t.db
        .update(contentVariants)
        .set({ approvedVersionId: "00000000-0000-4000-8000-000000000000" })
        .where(eq(contentVariants.id, variantId)),
    ).rejects.toThrow();
  });

  it("allows one live publication per variant, but dry runs and cancelled ones do not count", async () => {
    const v = await newVariant("en-GB");
    const versionId = await newVersion(v);
    const [first] = await newPublication(v, versionId, "pub:a:0");
    // A second live one is refused whatever its mode.
    await expect(
      newPublication(v, versionId, "pub:b:0", { mode: "IMMEDIATE", status: "QUEUED" }),
    ).rejects.toThrow();
    // A dry run never takes the slot.
    await newPublication(v, versionId, "pub:dry:0", { dryRun: true, status: "DRY_RUN_PASSED" });
    // A cancelled publication frees it.
    await t.db
      .update(publications)
      .set({ status: "CANCELLED" })
      .where(eq(publications.id, first?.id ?? ""));
    await newPublication(v, versionId, "pub:c:0");
    // The new live one holds the slot again.
    await expect(newPublication(v, versionId, "pub:d:0")).rejects.toThrow();
  });

  it("keeps idempotency keys and Instagram media ids unique", async () => {
    const v = await newVariant("en-AU");
    const versionId = await newVersion(v);
    await newPublication(v, versionId, "pub:k:0", {
      status: "PUBLISHED",
      instagramMediaId: "media-1",
    });
    const w = await newVariant("en-CA");
    const versionW = await newVersion(w);
    await expect(newPublication(w, versionW, "pub:k:0")).rejects.toThrow();
    await expect(
      newPublication(w, versionW, "pub:k:1", { instagramMediaId: "media-1" }),
    ).rejects.toThrow();
  });

  it("rejects an unknown publication mode and applies the defaults", async () => {
    const v = await newVariant("en-NZ");
    const versionId = await newVersion(v);
    await expect(
      newPublication(v, versionId, "pub:m:0", { mode: "LATER" as "SCHEDULED" }),
    ).rejects.toThrow();
    const [pub] = await newPublication(v, versionId, "pub:m:1");
    expect(pub).toMatchObject({
      dryRun: false,
      retryNo: 0,
      attemptCount: 0,
      igChildrenContainerIds: [],
      socialAccountId: null,
    });
  });

  it("allows one ACTIVE account per market and keeps updated_at current", async () => {
    const base = {
      marketId,
      username: "kitchen_es",
      instagramAccountId: "ig-1",
      accessTokenEncrypted: "enc:v1:xxx",
    };
    const [account] = await t.db.insert(socialAccounts).values(base).returning();
    expect(account).toMatchObject({
      platform: "instagram",
      status: "ACTIVE",
      tokenStatus: "VALID",
      scopes: [],
    });
    await expect(
      t.db
        .insert(socialAccounts)
        .values({ ...base, username: "other", instagramAccountId: "ig-2" }),
    ).rejects.toThrow();
    // The same Instagram account cannot be bound twice, active or not.
    await expect(
      t.db.insert(socialAccounts).values({ ...base, status: "DISABLED" }),
    ).rejects.toThrow();
    // A disabled account makes room for a new one.
    await new Promise((r) => setTimeout(r, 20));
    const [disabled] = await t.db
      .update(socialAccounts)
      .set({ status: "DISABLED" })
      .where(eq(socialAccounts.id, account?.id ?? ""))
      .returning();
    expect((disabled?.updatedAt.getTime() ?? 0) > (account?.updatedAt.getTime() ?? 0)).toBe(true);
    await t.db
      .insert(socialAccounts)
      .values({ ...base, username: "other", instagramAccountId: "ig-2" });
  });

  it("records publish attempts and integration events (0007_instagram_ops)", async () => {
    const result = await t.db.execute<{ relrowsecurity: boolean }>(
      sql`select relrowsecurity from pg_class where relname in ('publish_attempts', 'integration_events')`,
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => r.relrowsecurity)).toBe(true);

    const v = await newVariant("en-IE");
    const versionId = await newVersion(v);
    const [pub] = await newPublication(v, versionId, "pub:att:0");
    const publicationId = pub?.id ?? "";
    const [attempt] = await t.db
      .insert(publishAttempts)
      .values({
        publicationId,
        attemptNo: 1,
        step: "PUBLISH",
        endpoint: "/17841/media_publish",
        outcome: "AMBIGUOUS",
        request: { creation_id: "c1" },
      })
      .returning();
    expect(attempt).toMatchObject({ outcome: "AMBIGUOUS", httpStatus: null });
    expect(typeof attempt?.id).toBe("number");
    await expect(
      t.db.insert(publishAttempts).values({
        publicationId,
        attemptNo: 2,
        step: "PUBLISH",
        endpoint: "/x",
        outcome: "MAYBE" as "OK",
      }),
    ).rejects.toThrow();
    await expect(
      t.db.insert(publishAttempts).values({
        publicationId: "00000000-0000-4000-8000-000000000000",
        attemptNo: 1,
        step: "PUBLISH",
        endpoint: "/x",
        outcome: "OK",
      }),
    ).rejects.toThrow();

    const [event] = await t.db
      .insert(integrationEvents)
      .values({
        integration: "instagram",
        severity: "ERROR",
        code: "190",
        message: "Token expired",
      })
      .returning();
    expect(event).toMatchObject({ resolvedAt: null, socialAccountId: null });
    await expect(
      t.db.insert(integrationEvents).values({
        integration: "instagram",
        severity: "FATAL" as "ERROR",
        code: "x",
        message: "m",
      }),
    ).rejects.toThrow();
  });
});
