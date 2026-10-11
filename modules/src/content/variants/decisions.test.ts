import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rejectVariant, requestChanges, resubmitVariant, unapproveVariant } from "./decisions";
import { type ReviewFixture, reviewFixture } from "./test-support";

// Request changes, resubmit, reject and un-approve (M4-06).

describe("review decisions", () => {
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

  const events = (variantId: string) =>
    t.db
      .select()
      .from(schema.reviewEvents)
      .where(eq(schema.reviewEvents.contentVariantId, variantId));
  const audits = async (variantId: string) =>
    (
      await t.db
        .select({ action: schema.auditEvents.action })
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.entityId, variantId))
    ).map((a) => a.action);

  it("requests changes with a reason code and what should change, then resubmits", async () => {
    const { variantId } = await fx.makeVariant();
    const lock = (await fx.variant(variantId)).lockVersion;
    const changed = await requestChanges(fx.ctx, {
      variantId,
      reasonCode: "WEAK_HOOK",
      reason: "  The hook is too vague.  ",
    });
    expect(changed).toMatchObject({ status: "CHANGES_REQUESTED", lockVersion: lock + 1 });
    const [event] = await events(variantId);
    expect(event).toMatchObject({
      action: "REQUEST_CHANGES",
      reasonCode: "WEAK_HOOK",
      reason: "The hook is too vague.",
      reviewerId: fx.userId,
      variantLockVersion: lock,
    });
    expect(await audits(variantId)).toEqual(["variant.changes_requested"]);

    const back = await resubmitVariant(fx.ctx, { variantId });
    expect(back.status).toBe("READY_FOR_REVIEW");
    expect((await events(variantId)).map((e) => e.action)).toEqual(["REQUEST_CHANGES", "RESUBMIT"]);
  });

  it("insists on a known reason code and a reason for changes", async () => {
    const { variantId } = await fx.makeVariant();
    await expect(
      requestChanges(fx.ctx, { variantId, reasonCode: "WEAK_HOOK", reason: " " }),
    ).rejects.toThrow(ValidationError);
    await expect(
      requestChanges(fx.ctx, { variantId, reasonCode: "NOPE", reason: "x" }),
    ).rejects.toThrow(/not a reason code/);
    await expect(
      requestChanges(fx.ctx, { variantId, reasonCode: "", reason: "x" }),
    ).rejects.toThrow(ValidationError);
    expect((await fx.variant(variantId)).status).toBe("READY_FOR_REVIEW");
    expect(await events(variantId)).toEqual([]);
  });

  it("only moves along the machine", async () => {
    const changes = await fx.makeVariant({ status: "CHANGES_REQUESTED" });
    await expect(
      requestChanges(fx.ctx, {
        variantId: changes.variantId,
        reasonCode: "WEAK_HOOK",
        reason: "x",
      }),
    ).rejects.toThrow(InvalidStateError);
    const ready = await fx.makeVariant({ marketCode: "en" });
    await expect(resubmitVariant(fx.ctx, { variantId: ready.variantId })).rejects.toThrow(
      InvalidStateError,
    );
    await expect(
      requestChanges(fx.ctx, {
        variantId: "00000000-0000-4000-8000-000000000000",
        reasonCode: "WEAK_HOOK",
        reason: "x",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("rejects from review or from changes requested; the market can get a new draft", async () => {
    const a = await fx.makeVariant();
    const rejected = await rejectVariant(fx.ctx, {
      variantId: a.variantId,
      reasonCode: "OFF_BRAND_VOICE",
    });
    expect(rejected.status).toBe("REJECTED");
    const [event] = await events(a.variantId);
    expect(event).toMatchObject({ action: "REJECT", reasonCode: "OFF_BRAND_VOICE", reason: null });
    // Final: nothing leaves REJECTED.
    await expect(resubmitVariant(fx.ctx, { variantId: a.variantId })).rejects.toThrow(
      InvalidStateError,
    );
    await expect(
      rejectVariant(fx.ctx, { variantId: a.variantId, reasonCode: "OFF_BRAND_VOICE" }),
    ).rejects.toThrow(InvalidStateError);
    // The slot of (idea, market) is free again.
    const idea = (await fx.variant(a.variantId)).masterIdeaId;
    await expect(fx.makeVariant({ ideaId: idea })).resolves.toMatchObject({ marketId: a.marketId });

    const b = await fx.makeVariant({ status: "CHANGES_REQUESTED", marketCode: "en" });
    await rejectVariant(fx.ctx, {
      variantId: b.variantId,
      reasonCode: "OFF_BRAND_VOICE",
      reason: "Not for us",
    });
    expect((await fx.variant(b.variantId)).status).toBe("REJECTED");

    const approved = await fx.makeVariant({ status: "APPROVED", marketCode: "fr-FR" });
    await expect(
      rejectVariant(fx.ctx, { variantId: approved.variantId, reasonCode: "OFF_BRAND_VOICE" }),
    ).rejects.toThrow(InvalidStateError);
    await expect(rejectVariant(fx.ctx, { variantId: b.variantId, reasonCode: "" })).rejects.toThrow(
      ValidationError,
    );
  });

  it("withdraws an approval: back to review, post cancelled, version kept", async () => {
    const { variantId } = await fx.makeVariant({ status: "SCHEDULED" });
    const { versionId } = await fx.makeVersion(variantId);
    const publicationId = await fx.makePublication(variantId, versionId);
    const after = await unapproveVariant(fx.ctx, { variantId, reason: "Wrong offer" });
    expect(after).toMatchObject({ status: "READY_FOR_REVIEW", approvedVersionId: null });
    const [pub] = await t.db
      .select()
      .from(schema.publications)
      .where(eq(schema.publications.id, publicationId));
    expect(pub).toMatchObject({ status: "CANCELLED", cancelledBy: fx.userId });
    const [event] = await events(variantId);
    expect(event).toMatchObject({ action: "UNAPPROVE", reason: "Wrong offer" });
    expect(await t.db.select().from(schema.contentVariantVersions)).toHaveLength(1);
    expect(await audits(variantId)).toEqual(["variant.unapproved"]);
  });

  it("also withdraws a failed publication's approval, and needs a reason", async () => {
    const { variantId } = await fx.makeVariant({ status: "FAILED" });
    await expect(unapproveVariant(fx.ctx, { variantId, reason: " " })).rejects.toThrow(
      ValidationError,
    );
    expect((await unapproveVariant(fx.ctx, { variantId, reason: "Redo it" })).status).toBe(
      "READY_FOR_REVIEW",
    );
    const inReview = await fx.makeVariant({ marketCode: "en" });
    await expect(
      unapproveVariant(fx.ctx, { variantId: inReview.variantId, reason: "x" }),
    ).rejects.toThrow(InvalidStateError);
    const published = await fx.makeVariant({ status: "PUBLISHED", marketCode: "fr-FR" });
    await expect(
      unapproveVariant(fx.ctx, { variantId: published.variantId, reason: "x" }),
    ).rejects.toThrow(InvalidStateError);
  });
});
