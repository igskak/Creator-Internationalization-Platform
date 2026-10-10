import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { InvalidStateError, NotFoundError } from "@rc/lib/errors";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  allowedActions,
  approvalBlockers,
  approvalChecklist,
  assertTransition,
  canTransition,
  eventsFrom,
  nextStatus,
  VARIANT_EVENTS,
  VARIANT_TRANSITIONS,
  type VariantEvent,
  type VariantFacts,
  type VariantStatus,
} from "./index";
import { type ReviewFixture, reviewFixture } from "./test-support";
import { transitionVariant } from "./transition";

const STATUSES: VariantStatus[] = [
  "DRAFT",
  "GENERATING",
  "READY_FOR_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "SCHEDULED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
  "REJECTED",
];

// The table of plan 10 §10.4.3 written out again, status by status, independently of the code:
// what each event does from each status (anything not listed is refused).
const EXPECTED: Record<VariantStatus, Partial<Record<VariantEvent, VariantStatus>>> = {
  DRAFT: { START_PIPELINE: "GENERATING" },
  GENERATING: { PIPELINE_SUCCESS: "READY_FOR_REVIEW", PIPELINE_FAILURE: "DRAFT" },
  READY_FOR_REVIEW: {
    START_PIPELINE: "GENERATING",
    EDIT: "READY_FOR_REVIEW",
    REQUEST_CHANGES: "CHANGES_REQUESTED",
    APPROVE: "APPROVED",
    REJECT: "REJECTED",
  },
  CHANGES_REQUESTED: {
    START_PIPELINE: "GENERATING",
    EDIT: "CHANGES_REQUESTED",
    RESUBMIT: "READY_FOR_REVIEW",
    REJECT: "REJECTED",
  },
  APPROVED: {
    SCHEDULE: "SCHEDULED",
    PUBLISH_NOW: "PUBLISHING",
    EDIT: "READY_FOR_REVIEW",
    UNAPPROVE: "READY_FOR_REVIEW",
  },
  SCHEDULED: {
    CANCEL_SCHEDULE: "APPROVED",
    DISPATCH: "PUBLISHING",
    EDIT: "READY_FOR_REVIEW",
    UNAPPROVE: "READY_FOR_REVIEW",
  },
  PUBLISHING: { PUBLISH_SUCCESS: "PUBLISHED", PUBLISH_FAILURE: "FAILED" },
  PUBLISHED: {},
  FAILED: {
    RETRY: "PUBLISHING",
    RETRY_SCHEDULED: "SCHEDULED",
    EDIT: "READY_FOR_REVIEW",
    UNAPPROVE: "READY_FOR_REVIEW",
  },
  REJECTED: {},
};

describe("variant state machine: transition matrix", () => {
  for (const status of STATUSES) {
    for (const event of VARIANT_EVENTS) {
      const to = EXPECTED[status][event] ?? null;
      it(`${status} + ${event} → ${to ?? "refused"}`, () => {
        expect(nextStatus(status, event)).toBe(to);
        expect(canTransition(status, event)).toBe(to !== null);
        if (to) expect(assertTransition(status, event).to).toBe(to);
        else expect(() => assertTransition(status, event)).toThrow(InvalidStateError);
      });
    }
  }

  it("has no terminal status that leaves, and no dead event", () => {
    expect(eventsFrom("PUBLISHED")).toEqual([]);
    expect(eventsFrom("REJECTED")).toEqual([]);
    for (const event of VARIANT_EVENTS) {
      expect(VARIANT_TRANSITIONS.some((r) => r.event === event)).toBe(true);
    }
  });

  it("lists the guards and effects of the rows that matter", () => {
    const approve = assertTransition("READY_FOR_REVIEW", "APPROVE");
    expect(approve.guards).toEqual(
      expect.arrayContaining(["RENDER_CURRENT", "NO_BLOCKING_FLAGS", "CHECKLIST"]),
    );
    expect(approve.effects).toEqual(expect.arrayContaining(["SNAPSHOT", "CAMPAIGN_ID"]));
    const edit = assertTransition("SCHEDULED", "EDIT");
    expect(edit.guards).toContain("CONFIRM");
    expect(edit.effects).toEqual(expect.arrayContaining(["CANCEL_PUBLICATION", "CLEAR_APPROVAL"]));
    expect(assertTransition("APPROVED", "SCHEDULE").guards).toContain("TIME_AT_LEAST_5_MIN");
    // Editing in review needs no confirmation.
    expect(assertTransition("READY_FOR_REVIEW", "EDIT").guards).not.toContain("CONFIRM");
  });
});

const facts = (over: Partial<VariantFacts> = {}): VariantFacts => ({
  status: "READY_FOR_REVIEW",
  flags: [],
  render: "READY",
  hasContent: true,
  commercial: false,
  hasOffer: false,
  ctaType: "SAVE",
  ...over,
});
const actions = (f: VariantFacts, role?: "owner" | "editor" | "chef") =>
  allowedActions(f, role).map((a) => `${a.action}${a.enabled ? "" : "!"}`);

describe("variant state machine: allowed actions", () => {
  it("offers the review actions in review and the schedule actions when approved", () => {
    expect(actions(facts())).toEqual([
      "edit",
      "regenerateField",
      "regenerate",
      "requestChanges",
      "approve",
      "reject",
    ]);
    expect(actions(facts({ status: "CHANGES_REQUESTED" }))).toEqual([
      "edit",
      "regenerateField",
      "regenerate",
      "resubmit",
      "reject",
    ]);
    expect(actions(facts({ status: "APPROVED" }))).toEqual([
      "edit",
      "regenerateField",
      "unapprove",
      "schedule",
      "publishNow",
    ]);
    expect(actions(facts({ status: "SCHEDULED" }))).toEqual([
      "edit",
      "regenerateField",
      "unapprove",
      "cancelSchedule",
    ]);
    expect(actions(facts({ status: "FAILED" }))).toEqual([
      "edit",
      "regenerateField",
      "unapprove",
      "retry",
    ]);
  });

  it("offers nothing while generating, publishing or in a terminal status", () => {
    for (const status of ["GENERATING", "PUBLISHING", "PUBLISHED", "REJECTED"] as const) {
      expect(actions(facts({ status }))).toEqual([]);
    }
    expect(actions(facts({ status: "DRAFT", hasContent: false }))).toEqual(["regenerate"]);
  });

  it("asks for confirmation when an edit would undo an approval", () => {
    const byAction = (f: VariantFacts) =>
      Object.fromEntries(allowedActions(f).map((a) => [a.action, a.confirm]));
    expect(byAction(facts()).edit).toBe(false);
    expect(byAction(facts({ status: "APPROVED" }))).toMatchObject({ edit: true, unapprove: true });
    expect(byAction(facts({ status: "SCHEDULED" })).edit).toBe(true);
  });

  it("disables editing a draft that has no content", () => {
    const a = allowedActions(facts({ hasContent: false }));
    expect(a.find((x) => x.action === "edit")).toMatchObject({
      enabled: false,
      blockers: [{ code: "NO_CONTENT" }],
    });
  });

  it("keeps scheduling for owners and editors", () => {
    const f = facts({ status: "APPROVED" });
    expect(actions(f, "chef")).toEqual(
      expect.arrayContaining(["schedule!", "publishNow!", "unapprove"]),
    );
    expect(actions(f, "editor")).toEqual(expect.arrayContaining(["schedule", "publishNow"]));
    expect(actions(f, "owner")).toEqual(expect.arrayContaining(["schedule", "publishNow"]));
    expect(allowedActions(f, "chef").find((a) => a.action === "schedule")?.blockers[0]?.code).toBe(
      "ROLE",
    );
  });
});

describe("approval blockers and checklist", () => {
  it("passes a clean variant with a current render", () => {
    expect(approvalBlockers(facts())).toEqual([]);
    expect(allowedActions(facts()).find((a) => a.action === "approve")?.enabled).toBe(true);
  });

  it("blocks on a missing, running, stale or failed render", () => {
    const code = (render: VariantFacts["render"]) =>
      approvalBlockers(facts({ render })).map((b) => b.code);
    expect(code("NONE")).toEqual(["RENDER_MISSING"]);
    expect(code("RENDERING")).toEqual(["RENDER_RUNNING"]);
    expect(code("STALE")).toEqual(["RENDER_STALE"]);
    expect(code("FAILED")).toEqual(["RENDER_FAILED"]);
  });

  it("blocks on every blocking flag but not on the others", () => {
    for (const flag of [
      "UNSUPPORTED_CLAIM",
      "NUMERIC_MISMATCH",
      "TEXT_OVERFLOW",
      "MISSING_GLYPH",
      "RENDER_FAILED",
      "VISUAL_MISSING",
      "KNOWLEDGE_ARCHIVED",
    ]) {
      expect(approvalBlockers(facts({ flags: [flag] }))).toMatchObject([
        { code: "BLOCKING_FLAG", flag },
      ]);
    }
    for (const flag of ["SAFETY_REVIEW", "DUPLICATION_RISK", "KNOWLEDGE_CHANGED"]) {
      expect(approvalBlockers(facts({ flags: [flag] }))).toEqual([]);
    }
  });

  it("needs an offer for commercial ideas", () => {
    expect(approvalBlockers(facts({ commercial: true })).map((b) => b.code)).toEqual([
      "OFFER_MISSING",
    ]);
    expect(approvalBlockers(facts({ commercial: true, hasOffer: true }))).toEqual([]);
  });

  it("reports only the missing draft when there is no content", () => {
    expect(
      approvalBlockers(facts({ hasContent: false, render: "NONE" })).map((b) => b.code),
    ).toEqual(["NO_CONTENT"]);
  });

  it("builds the checklist from the flags and the CTA", () => {
    expect(approvalChecklist({ flags: [], ctaType: "SAVE" })).toEqual(["factsChecked"]);
    expect(approvalChecklist({ flags: ["SAFETY_REVIEW"], ctaType: null })).toEqual([
      "factsChecked",
      "safetyChecked",
    ]);
    expect(approvalChecklist({ flags: [], ctaType: "COMMENT_KEYWORD" })).toEqual([
      "factsChecked",
      "manychatConfigured",
    ]);
    expect(approvalChecklist({ flags: ["SAFETY_REVIEW"], ctaType: "DM_KEYWORD" })).toEqual([
      "factsChecked",
      "safetyChecked",
      "manychatConfigured",
    ]);
    expect(
      allowedActions(facts({ ctaType: "DM_KEYWORD" })).find((a) => a.action === "approve")
        ?.checklist,
    ).toEqual(["factsChecked", "manychatConfigured"]);
  });
});

describe("transitionVariant", () => {
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

  const auditActions = async (variantId: string) =>
    (
      await t.db
        .select({ action: schema.auditEvents.action, data: schema.auditEvents.data })
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.entityId, variantId))
    ).map((a) => a.action);

  it("changes the status, bumps the lock and writes one audit event", async () => {
    const { variantId } = await fx.makeVariant();
    const before = await fx.variant(variantId);
    const after = await transitionVariant(fx.ctx, {
      variantId,
      event: "REQUEST_CHANGES",
      reason: "Hook too long",
    });
    expect(after.status).toBe("CHANGES_REQUESTED");
    expect(after.lockVersion).toBe(before.lockVersion + 1);
    expect(after.statusChangedAt.toISOString()).toBe("2026-10-10T12:00:00.000Z");
    const [event] = await t.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, variantId));
    expect(event).toMatchObject({
      action: "variant.changes_requested",
      entityType: "content_variant",
      actorUserId: fx.userId,
      data: {
        event: "REQUEST_CHANGES",
        reason: "Hook too long",
        from: "READY_FOR_REVIEW",
        to: "CHANGES_REQUESTED",
      },
    });
  });

  it("refuses an event the machine does not allow and leaves the row alone", async () => {
    const { variantId } = await fx.makeVariant({ status: "PUBLISHED" });
    await expect(transitionVariant(fx.ctx, { variantId, event: "APPROVE" })).rejects.toThrow(
      InvalidStateError,
    );
    expect((await fx.variant(variantId)).status).toBe("PUBLISHED");
    expect(await auditActions(variantId)).toEqual([]);
  });

  it("refuses an unknown variant", async () => {
    await expect(
      transitionVariant(fx.ctx, {
        variantId: "00000000-0000-4000-8000-000000000000",
        event: "REJECT",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("refuses an event that keeps the status", async () => {
    const { variantId } = await fx.makeVariant();
    await expect(transitionVariant(fx.ctx, { variantId, event: "EDIT" })).rejects.toThrow(
      /does not change the status/,
    );
  });

  it("writes extra columns in the same update", async () => {
    const { variantId } = await fx.makeVariant();
    const after = await transitionVariant(fx.ctx, {
      variantId,
      event: "REJECT",
      set: { lastError: { code: "X", message: "m" } },
    });
    expect(after).toMatchObject({ status: "REJECTED", lastError: { code: "X" } });
  });

  it("cancels the open publication and clears the approval when an approved variant goes back", async () => {
    const { variantId, marketId } = await fx.makeVariant({ status: "SCHEDULED" });
    const renderId = await fx.makeRender(variantId);
    const [version] = await t.db
      .insert(schema.contentVariantVersions)
      .values({
        contentVariantId: variantId,
        versionNo: 1,
        snapshot: {
          hook: "Hola",
          hookType: "QUESTION",
          caption: "c",
          cta: { type: "SAVE", text: "Guárdalo" },
          hashtags: [],
          slides: [],
          visualStyle: "WARM",
          templateSequence: [],
          renderId,
          renderedSlideKeys: [],
          knowledge: [],
          generationVersion: "1.2.0",
        },
        carouselRenderId: renderId,
        contentHash: "h",
        approvedBy: fx.userId,
      })
      .returning();
    await t.db
      .update(schema.contentVariants)
      .set({ approvedVersionId: version?.id ?? null })
      .where(eq(schema.contentVariants.id, variantId));
    const [pub] = await t.db
      .insert(schema.publications)
      .values({
        contentVariantId: variantId,
        contentVariantVersionId: version?.id ?? "",
        marketId,
        mode: "SCHEDULED",
        scheduledAt: new Date("2026-12-01T10:00:00Z"),
        status: "SCHEDULED",
        idempotencyKey: "pub:t:0",
      })
      .returning();

    const after = await transitionVariant(fx.ctx, {
      variantId,
      event: "UNAPPROVE",
      reason: "Wrong offer",
    });
    expect(after).toMatchObject({ status: "READY_FOR_REVIEW", approvedVersionId: null });
    const [cancelled] = await t.db
      .select()
      .from(schema.publications)
      .where(eq(schema.publications.id, pub?.id ?? ""));
    expect(cancelled).toMatchObject({ status: "CANCELLED", cancelledBy: fx.userId });
    expect(cancelled?.cancelledAt).toBeInstanceOf(Date);
    const [cancelAudit] = await t.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, pub?.id ?? ""));
    expect(cancelAudit?.action).toBe("publication.cancelled");
    expect(await auditActions(variantId)).toEqual(["variant.unapproved"]);
    // The approval history stays: the version row is never deleted.
    expect(await t.db.select().from(schema.contentVariantVersions)).toHaveLength(1);
  });

  it("restores APPROVED when a schedule is cancelled", async () => {
    const { variantId } = await fx.makeVariant({ status: "SCHEDULED" });
    const after = await transitionVariant(fx.ctx, { variantId, event: "CANCEL_SCHEDULE" });
    expect(after.status).toBe("APPROVED");
  });
});
