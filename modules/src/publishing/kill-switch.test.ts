import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { ForbiddenError, ValidationError } from "@rc/lib/errors";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ReviewFixture, reviewFixture } from "../content/variants/test-support";
import { mockRuntime, newMock } from "../instagram/test-support";
import { dispatchDuePublications } from "./dispatcher";
import { getPublishingStatus, setPublishingEnabled } from "./kill-switch";
import { runPublication } from "./publish-machine";

// Environment guards and the kill switch (M5-08). The mode and allowlist rules themselves are
// exercised in publish-machine.test.ts and dispatch.test.ts; here: the switch and its status.

describe("kill switch", () => {
  let t: TestDb;
  let fx: ReviewFixture;
  const mock = newMock();

  async function setup(mode: "off" | "dry_run_only" | "live" = "live", allowlist = ["1784"]) {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    fx = await reviewFixture(t.db, {
      instagram: mockRuntime(mock, { publishMode: mode, allowlist }),
    });
  }
  beforeEach(async () => {
    await setup();
  });
  afterEach(async () => {
    await t.close();
  });

  const setting = async () =>
    (
      await t.db
        .select()
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, "publishing.enabled"))
    )[0];

  it("starts off after the seed, and the status says what the environment and the switch allow", async () => {
    expect(await getPublishingStatus(fx.ctx)).toEqual({
      mode: "live",
      enabled: false,
      live: false,
      allowlist: ["1784"],
    });
    await setPublishingEnabled(fx.ctx, { enabled: true, reason: "Go live" });
    expect(await getPublishingStatus(fx.ctx)).toMatchObject({ enabled: true, live: true });
    await t.close();
    await setup("dry_run_only");
    await setPublishingEnabled(fx.ctx, { enabled: true, reason: "x" });
    expect(await getPublishingStatus(fx.ctx)).toMatchObject({
      mode: "dry_run_only",
      enabled: true,
      live: false,
    });
    await t.close();
    await setup("off", []);
    expect(await getPublishingStatus(fx.ctx)).toMatchObject({
      mode: "off",
      live: false,
      allowlist: [],
    });
  });

  it("switches on and off for owners, with a reason, and audits who, why and from what", async () => {
    await setPublishingEnabled(fx.ctx, { enabled: true, reason: "First posts approved" });
    expect((await setting())?.value).toBe(true);
    expect((await setting())?.updatedBy).toBe(fx.userId);
    await setPublishingEnabled(fx.ctx, {
      enabled: false,
      reason: "Wrong caption on the first post",
    });
    expect((await setting())?.value).toBe(false);
    const events = (
      await t.db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.entityType, "app_setting"))
    ).filter((e) => e.action.startsWith("publishing."));
    expect(events.map((e) => [e.action, e.actorUserId])).toEqual([
      ["publishing.enabled", fx.userId],
      ["publishing.disabled", fx.userId],
    ]);
    expect(events[1]?.data).toMatchObject({
      from: true,
      to: false,
      reason: "Wrong caption on the first post",
      mode: "live",
    });
  });

  it("is for owners only and needs a reason", async () => {
    for (const role of ["editor", "chef"] as const) {
      await expect(
        setPublishingEnabled(fx.as(role), { enabled: true, reason: "x" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(
      setPublishingEnabled(fx.ctx, { enabled: true, reason: "  " }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await setting())?.value).toBe(false);
  });

  it("stops the dispatcher and a post on its way when it is switched off", async () => {
    // Off: the dispatcher holds a due live post.
    const made = await fx.makeVariant({ status: "SCHEDULED" });
    const { versionId } = await fx.makeVersion(made.variantId);
    const publicationId = await fx.makePublication(made.variantId, versionId, {
      scheduledAt: new Date("2026-10-10T11:00:00Z"),
    });
    expect(await dispatchDuePublications(fx.ctx)).toMatchObject({
      blocked: "KILL_SWITCH",
      dispatched: [],
    });
    // A post that is already QUEUED fails its guards without any Graph call, and can be retried later.
    await t.db
      .update(schema.publications)
      .set({ status: "QUEUED" })
      .where(eq(schema.publications.id, publicationId));
    const out = await runPublication(
      { ...fx.ctx, actor: { type: "JOB", jobRunId: "r1" } },
      { publicationId },
    );
    expect(out).toMatchObject({ status: "FAILED", error: { type: "GUARD_PUBLISHING_OFF" } });
    expect(mock.calls).toHaveLength(0);
  });
});
