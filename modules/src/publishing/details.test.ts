import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { NotFoundError } from "@rc/lib/errors";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ReviewFixture, reviewFixture } from "../content/variants/test-support";
import { errorKind, getPublicationDetails, listVariantPublications } from "./details";

// The publication drawer's data and the review panel's summaries (M5-09).

describe("publication details", () => {
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

  async function post(over: Partial<typeof schema.publications.$inferInsert> = {}) {
    const made = await fx.makeVariant({ status: "FAILED" });
    const { versionId } = await fx.makeVersion(made.variantId);
    const publicationId = await fx.makePublication(made.variantId, versionId, over);
    return { ...made, versionId, publicationId };
  }

  it("gives the publication, its market, title, error and calls in order", async () => {
    const { publicationId, variantId } = await post({
      status: "FAILED",
      mode: "IMMEDIATE",
      scheduledAt: null,
      step: "PUBLISH",
      retryNo: 1,
      attemptCount: 5,
      lastError: {
        message: "boom",
        code: 190,
        subcode: 463,
        fbtraceId: "T1",
        classification: "AUTH",
      },
    });
    await t.db.insert(schema.publishAttempts).values([
      {
        publicationId,
        attemptNo: 1,
        step: "GUARDS",
        endpoint: "/1/content_publishing_limit",
        outcome: "OK",
        httpStatus: 200,
        createdAt: new Date("2026-10-10T12:00:01Z"),
      },
      {
        publicationId,
        attemptNo: 1,
        step: "PUBLISH",
        endpoint: "/1/media_publish",
        outcome: "PERMANENT_ERROR",
        httpStatus: 400,
        errorCode: "190",
        errorSubcode: "463",
        fbtraceId: "T1",
        durationMs: 120,
        createdAt: new Date("2026-10-10T12:00:09Z"),
      },
    ]);
    const details = await getPublicationDetails(fx.ctx, { publicationId });
    expect(details).toMatchObject({
      id: publicationId,
      variantId,
      title: "Hola",
      status: "FAILED",
      mode: "IMMEDIATE",
      dryRun: false,
      step: "PUBLISH",
      retryNo: 1,
      market: { code: "es-ES", timezone: "Europe/Madrid" },
      account: null,
      canRetry: true,
      canCancel: false,
      error: { kind: "AUTH", code: 190, subcode: 463, fbtraceId: "T1", message: "boom" },
    });
    expect(details.attempts.map((a) => [a.step, a.endpoint, a.outcome])).toEqual([
      ["GUARDS", "/1/content_publishing_limit", "OK"],
      ["PUBLISH", "/1/media_publish", "PERMANENT_ERROR"],
    ]);
    expect(details.ideaId).toBeTruthy();
  });

  it("says what can be done with a scheduled and a queued post", async () => {
    const scheduled = await getPublicationDetails(fx.ctx, {
      publicationId: (await post({ status: "SCHEDULED" })).publicationId,
    });
    expect(scheduled).toMatchObject({ canCancel: true, canRetry: false, error: null });
    const queued = await getPublicationDetails(fx.ctx, {
      publicationId: (await post({ status: "QUEUED" })).publicationId,
    });
    expect(queued).toMatchObject({ canCancel: true, canRetry: false });
    const done = await getPublicationDetails(fx.ctx, {
      publicationId: (
        await post({
          status: "PUBLISHED",
          instagramMediaId: "m1",
          permalink: "https://www.instagram.com/p/x/",
        })
      ).publicationId,
    });
    expect(done).toMatchObject({
      canCancel: false,
      canRetry: false,
      permalink: "https://www.instagram.com/p/x/",
    });
  });

  it("refuses an unknown publication", async () => {
    await expect(
      getPublicationDetails(fx.ctx, { publicationId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("names the kind of an error for the UI", () => {
    expect(errorKind({ message: "m", classification: "AUTH" })).toBe("AUTH");
    expect(
      errorKind({ message: "m", type: "GUARD_NOT_ALLOWLISTED", classification: "PERMANENT" }),
    ).toBe("GUARD_NOT_ALLOWLISTED");
    expect(
      errorKind({ message: "m", type: "MANUAL_CHECK_REQUIRED", classification: "UNKNOWN" }),
    ).toBe("MANUAL_CHECK_REQUIRED");
    expect(
      errorKind({
        message: "could not download the image",
        code: 100,
        subcode: 2207003,
        classification: "INVALID_MEDIA",
      }),
    ).toBe("INVALID_MEDIA_FETCH");
    expect(errorKind({ message: "aspect ratio", classification: "INVALID_MEDIA" })).toBe(
      "INVALID_MEDIA",
    );
  });

  it("summarizes the newest real post and the newest dry run of each draft, ignoring cancelled posts", async () => {
    const made = await fx.makeVariant({ status: "APPROVED" });
    const { versionId } = await fx.makeVersion(made.variantId);
    const cancelled = await fx.makePublication(made.variantId, versionId, { status: "CANCELLED" });
    const dryOld = await fx.makePublication(made.variantId, versionId, {
      dryRun: true,
      status: "FAILED",
      mode: "IMMEDIATE",
      scheduledAt: null,
    });
    const dryNew = await fx.makePublication(made.variantId, versionId, {
      dryRun: true,
      status: "DRY_RUN_PASSED",
      mode: "IMMEDIATE",
      scheduledAt: null,
    });
    const live = await fx.makePublication(made.variantId, versionId, { status: "SCHEDULED" });
    for (const [i, id] of [cancelled, dryOld, dryNew, live].entries()) {
      await t.db.execute(
        `update publications set created_at = now() + interval '${i} seconds' where id = '${id}'` as never,
      );
    }
    const other = await fx.makeVariant({ status: "READY_FOR_REVIEW" });
    const summaries = await listVariantPublications(fx.ctx, [made.variantId, other.variantId]);
    expect(summaries[made.variantId]?.current).toMatchObject({
      id: live,
      status: "SCHEDULED",
      dryRun: false,
    });
    expect(summaries[made.variantId]?.lastDryRun).toMatchObject({
      id: dryNew,
      status: "DRY_RUN_PASSED",
      dryRun: true,
    });
    expect(summaries[other.variantId]).toEqual({ current: null, lastDryRun: null });
    expect(await listVariantPublications(fx.ctx, [])).toEqual({});
  });
});
