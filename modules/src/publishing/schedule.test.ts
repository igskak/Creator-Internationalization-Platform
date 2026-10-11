import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { ConflictError, InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { approveVariant } from "../content";
import { type ReviewFixture, reviewFixture } from "../content/variants/test-support";
import {
  cancelPublication,
  describeSlot,
  reschedulePublication,
  schedulePublication,
} from "./schedule";

// The scheduling service (M4-08): times, the one live post per variant, warnings, cancel.

const NOW = "2026-10-10T12:00:00.000Z";
const at = (minutes: number) => new Date(Date.parse(NOW) + minutes * 60_000).toISOString();
const DAY = 24 * 60;

describe("scheduling", () => {
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

  /** A variant that went through the real approval, so its version is intact. */
  const approved = async (marketCode?: string) => {
    const made = await fx.makeVariant(marketCode ? { marketCode } : {});
    await fx.makeRender(made.variantId);
    await approveVariant(fx.ctx, {
      variantId: made.variantId,
      lockVersion: (await fx.variant(made.variantId)).lockVersion,
      checklist: { factsChecked: true },
    });
    return made;
  };
  const schedule = (variantId: string, scheduledAt = at(2 * DAY)) =>
    schedulePublication(fx.ctx, { variantId, scheduledAt });
  const audits = async (entityId: string) =>
    (
      await t.db
        .select({ action: schema.auditEvents.action, data: schema.auditEvents.data })
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.entityId, entityId))
    ).map((a) => a.action);

  it("schedules an approved draft: a SCHEDULED publication of its version, the draft SCHEDULED", async () => {
    const { variantId, marketId } = await approved();
    const before = await fx.variant(variantId);
    const { publication, warnings } = await schedule(variantId);
    expect(publication).toMatchObject({
      contentVariantId: variantId,
      contentVariantVersionId: before.approvedVersionId,
      marketId,
      mode: "SCHEDULED",
      status: "SCHEDULED",
      dryRun: false,
      retryNo: 0,
      socialAccountId: null,
      createdBy: fx.userId,
    });
    expect(publication.scheduledAt?.toISOString()).toBe(at(2 * DAY));
    expect(publication.idempotencyKey).toBe(`pub:${publication.id}:0`);
    expect(await fx.variant(variantId)).toMatchObject({
      status: "SCHEDULED",
      lockVersion: before.lockVersion + 1,
    });
    expect(warnings.map((w) => w.code)).toEqual(["NO_ACTIVE_ACCOUNT", "PUBLISHING_DISABLED"]);
    expect(await audits(publication.id)).toEqual(["publication.scheduled"]);
    expect(await audits(variantId)).toContain("variant.scheduled");
  });

  it("refuses a time in the past or less than five minutes ahead; five is enough", async () => {
    const { variantId } = await approved();
    for (const minutes of [-60, 0, 4]) {
      const error = await schedule(variantId, at(minutes)).catch((e) => e);
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.fieldErrors.scheduledAt[0]).toMatch(/at least 5 minutes/);
    }
    expect((await fx.variant(variantId)).status).toBe("APPROVED");
    expect(await t.db.select().from(schema.publications)).toEqual([]);
    await expect(schedule(variantId, at(5))).resolves.toMatchObject({
      publication: { status: "SCHEDULED" },
    });
  });

  it("needs a time for a scheduled post", async () => {
    const { variantId } = await approved();
    await expect(schedulePublication(fx.ctx, { variantId, mode: "SCHEDULED" })).rejects.toThrow(
      ValidationError,
    );
    await expect(
      schedulePublication(fx.ctx, { variantId, scheduledAt: "tomorrow" }),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses to publish now or dry-run while Instagram is off in this environment", async () => {
    const { variantId } = await approved();
    await expect(schedulePublication(fx.ctx, { variantId, mode: "IMMEDIATE" })).rejects.toThrow(
      /switched off in this environment/,
    );
    await expect(
      schedulePublication(fx.ctx, { variantId, scheduledAt: at(DAY), dryRun: true }),
    ).rejects.toThrow(InvalidStateError);
  });

  it("refuses a second live post for the same draft", async () => {
    const { variantId } = await approved();
    await schedule(variantId);
    await expect(schedule(variantId, at(3 * DAY))).rejects.toThrow(/already scheduled/);
    expect(await t.db.select().from(schema.publications)).toHaveLength(1);
  });

  it("falls back on the database when two requests race for the same draft", async () => {
    const { variantId } = await approved();
    const version = (await fx.variant(variantId)).approvedVersionId as string;
    // A live publication that the variant's status does not show (as in a race).
    await fx.makePublication(variantId, version);
    await expect(schedule(variantId)).rejects.toThrow(ConflictError);
    expect((await fx.variant(variantId)).status).toBe("APPROVED");
  });

  it("only schedules approved drafts", async () => {
    for (const status of [
      "DRAFT",
      "READY_FOR_REVIEW",
      "CHANGES_REQUESTED",
      "PUBLISHED",
      "REJECTED",
    ] as const) {
      const { variantId } = await fx.makeVariant({ status });
      await expect(schedule(variantId)).rejects.toThrow(InvalidStateError);
    }
    await expect(schedule("00000000-0000-4000-8000-000000000000")).rejects.toThrow(NotFoundError);
  });

  it("refuses a draft whose approved version no longer matches its images", async () => {
    const { variantId } = await approved();
    await t.db.delete(schema.renderedSlides);
    const error = await schedule(variantId).catch((e) => e);
    expect(error).toBeInstanceOf(InvalidStateError);
    expect(error.details.problems).toEqual(
      expect.arrayContaining(["The images of the render are not the ones in the snapshot."]),
    );
  });

  describe("warnings", () => {
    it("tells when another post of the market is close, and not when it is far enough", async () => {
      const first = await approved("es-ES");
      const a = await schedule(first.variantId, at(2 * DAY));
      expect(a.warnings.map((w) => w.code)).not.toContain("MIN_GAP");
      // A second draft of the same market, 60 minutes later (the gap is 180).
      const other = await approvedOfNewIdea("es-ES");
      const close = await schedule(other, at(2 * DAY + 60));
      const gap = close.warnings.find((w) => w.code === "MIN_GAP");
      expect(gap).toMatchObject({
        otherPublicationId: a.publication.id,
        otherAt: at(2 * DAY),
        minGapMinutes: 180,
      });
      // 180 minutes from every other post (the nearest is the second, 240 minutes earlier) is enough.
      const third = await approvedOfNewIdea("es-ES");
      const far = await schedule(third, at(2 * DAY + 300));
      expect(far.warnings.map((w) => w.code)).not.toContain("MIN_GAP");
      // Another market's post does not count.
      const en = await approvedOfNewIdea("en");
      const sameTime = await schedule(en, at(2 * DAY));
      expect(sameTime.warnings.map((w) => w.code)).not.toContain("MIN_GAP");
    });

    it("follows the settings and the connected account", async () => {
      await t.db
        .update(schema.appSettings)
        .set({ value: true })
        .where(eq(schema.appSettings.key, "publishing.enabled"));
      const { variantId, marketId } = await approved();
      await t.db.insert(schema.socialAccounts).values({
        marketId,
        username: "kitchen_es",
        instagramAccountId: "ig-1",
        accessTokenEncrypted: "enc:v1:x",
      });
      expect((await schedule(variantId)).warnings).toEqual([]);

      await t.db
        .update(schema.appSettings)
        .set({ value: 0 })
        .where(eq(schema.appSettings.key, "publishing.min_gap_minutes"));
      const next = await approvedOfNewIdea("es-ES");
      expect((await schedule(next, at(2 * DAY + 1))).warnings).toEqual([]);
    });

    async function approvedOfNewIdea(marketCode: string): Promise<string> {
      return (await approved(marketCode)).variantId;
    }
  });

  describe("moving and cancelling", () => {
    it("moves a scheduled post; the old time and the new are in the audit", async () => {
      const { variantId } = await approved();
      const { publication } = await schedule(variantId);
      const moved = await reschedulePublication(fx.ctx, {
        publicationId: publication.id,
        scheduledAt: at(3 * DAY),
      });
      expect(moved.publication.scheduledAt?.toISOString()).toBe(at(3 * DAY));
      expect(moved.publication.idempotencyKey).toBe(publication.idempotencyKey);
      expect((await fx.variant(variantId)).status).toBe("SCHEDULED");
      const [event] = await t.db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.action, "publication.rescheduled"));
      expect(event?.data).toMatchObject({ from: at(2 * DAY), to: at(3 * DAY), variantId });
    });

    it("keeps the same rules for a new time, and moves only a scheduled post", async () => {
      const { variantId } = await approved();
      const { publication } = await schedule(variantId);
      await expect(
        reschedulePublication(fx.ctx, { publicationId: publication.id, scheduledAt: at(2) }),
      ).rejects.toThrow(ValidationError);
      await t.db
        .update(schema.publications)
        .set({ status: "QUEUED" })
        .where(eq(schema.publications.id, publication.id));
      await expect(
        reschedulePublication(fx.ctx, { publicationId: publication.id, scheduledAt: at(DAY) }),
      ).rejects.toThrow(InvalidStateError);
      await expect(
        reschedulePublication(fx.ctx, {
          publicationId: "00000000-0000-4000-8000-000000000000",
          scheduledAt: at(DAY),
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it("does not warn about its own old time when it is moved a little", async () => {
      const { variantId } = await approved();
      const { publication } = await schedule(variantId);
      const moved = await reschedulePublication(fx.ctx, {
        publicationId: publication.id,
        scheduledAt: at(2 * DAY + 30),
      });
      expect(moved.warnings.map((w) => w.code)).not.toContain("MIN_GAP");
    });

    it("cancelling restores APPROVED, keeps who and when, and the draft can be scheduled again", async () => {
      const { variantId } = await approved();
      const { publication } = await schedule(variantId);
      const cancelled = await cancelPublication(fx.ctx, {
        publicationId: publication.id,
        reason: "Wrong day",
      });
      expect(cancelled).toMatchObject({ status: "CANCELLED", cancelledBy: fx.userId });
      expect(cancelled.cancelledAt?.toISOString()).toBe(NOW);
      expect((await fx.variant(variantId)).status).toBe("APPROVED");
      const events = await t.db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.entityId, publication.id));
      expect(events.map((e) => e.action)).toEqual([
        "publication.scheduled",
        "publication.cancelled",
      ]);
      expect(events[1]?.data).toMatchObject({ reason: "Wrong day" });

      const again = await schedule(variantId, at(4 * DAY));
      expect(again.publication.id).not.toBe(publication.id);
      expect(again.publication.contentVariantVersionId).toBe(publication.contentVariantVersionId);
      expect((await fx.variant(variantId)).status).toBe("SCHEDULED");
    });

    it("cancels a queued post too, but not one that is running or done", async () => {
      const { variantId } = await approved();
      const { publication } = await schedule(variantId);
      await t.db
        .update(schema.publications)
        .set({ status: "QUEUED" })
        .where(eq(schema.publications.id, publication.id));
      await expect(
        cancelPublication(fx.ctx, { publicationId: publication.id, reason: "x" }),
      ).resolves.toMatchObject({ status: "CANCELLED" });

      for (const status of ["IN_PROGRESS", "PUBLISHED", "CANCELLED", "FAILED"] as const) {
        const other = await approved("en");
        const made = await schedule(other.variantId);
        await t.db
          .update(schema.publications)
          .set({ status })
          .where(eq(schema.publications.id, made.publication.id));
        await expect(
          cancelPublication(fx.ctx, { publicationId: made.publication.id, reason: "x" }),
        ).rejects.toThrow(InvalidStateError);
        await t.db
          .delete(schema.publications)
          .where(eq(schema.publications.id, made.publication.id));
        await t.db
          .update(schema.contentVariants)
          .set({ status: "REJECTED" })
          .where(eq(schema.contentVariants.id, other.variantId));
      }
    });

    it("needs a reason", async () => {
      const { variantId } = await approved();
      const { publication } = await schedule(variantId);
      await expect(
        cancelPublication(fx.ctx, { publicationId: publication.id, reason: "  " }),
      ).rejects.toThrow(ValidationError);
      expect((await fx.variant(variantId)).status).toBe("SCHEDULED");
    });
  });

  it("describes a time in the market's zone", () => {
    expect(describeSlot(new Date("2026-10-20T11:00:00Z"), "Europe/Madrid")).toBe(
      "2026-10-20 13:00 (UTC+2)",
    );
    expect(describeSlot(new Date("2026-12-01T12:00:00Z"), "Europe/Madrid")).toBe(
      "2026-12-01 13:00 (UTC+1)",
    );
  });
});
