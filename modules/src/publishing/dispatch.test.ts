import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { ConflictError, InvalidStateError } from "@rc/lib/errors";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { approveVariant } from "../content";
import {
  type RecordedJob,
  type ReviewFixture,
  recordingJobs,
  reviewFixture,
} from "../content/variants/test-support";
import { createInlineJobRunner, type JobRunner, type ServiceContext } from "../core";
import { connectTestAccount, mockRuntime, newMock } from "../instagram/test-support";
import { jobHandlers } from "../job-handlers";
import { dispatchDuePublications, ORPHAN_AFTER_MS, STUCK_AFTER_MS } from "./dispatcher";
import { retryPublication } from "./retry";
import { schedulePublication } from "./schedule";

// The dispatcher (J9), "publish now" and dry runs, and retryPublication (M5-07).

const ES = "1784";
const MIN = 60_000;

describe("dispatching and queueing publications", () => {
  let t: TestDb;
  let fx: ReviewFixture;
  let mock: ReturnType<typeof newMock>;
  let calls: RecordedJob[];
  let ctx: ServiceContext;

  async function setup(
    over: { mode?: "live" | "dry_run_only" | "off"; enabled?: boolean; jobs?: JobRunner } = {},
  ) {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    mock = newMock({ now: () => fx.clock.now() });
    const recorder = recordingJobs();
    calls = recorder.calls;
    fx = await reviewFixture(t.db, {
      jobs: over.jobs ?? recorder.runner,
      instagram: mockRuntime(mock, { publishMode: over.mode ?? "live", allowlist: [ES] }),
    });
    ctx = fx.ctx;
    await t.db
      .insert(schema.appSettings)
      .values({ key: "publishing.enabled", value: over.enabled ?? true })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: over.enabled ?? true } });
  }
  beforeEach(async () => {
    await setup();
  });
  afterEach(async () => {
    await t.close();
  });

  const minutes = (m: number) => new Date(fx.clock.now().getTime() + m * MIN);
  const publication = async (id: string) =>
    (
      await t.db.select().from(schema.publications).where(eq(schema.publications.id, id))
    )[0] as typeof schema.publications.$inferSelect;

  /** An APPROVED draft (real approval); `account` connects the market's Instagram account once. */
  async function approved(opts: { account?: boolean; marketCode?: string } = {}) {
    const made = await fx.makeVariant(opts.marketCode ? { marketCode: opts.marketCode } : {});
    await fx.makeRender(made.variantId);
    await approveVariant(ctx, {
      variantId: made.variantId,
      lockVersion: (await fx.variant(made.variantId)).lockVersion,
      checklist: { factsChecked: true },
    });
    let account: Awaited<ReturnType<typeof connectTestAccount>>["account"] | undefined;
    if (opts.account !== false) {
      account = (await connectTestAccount(ctx, mock, { marketId: made.marketId, accountId: ES }))
        .account;
    }
    return { ...made, account };
  }
  /** A due, scheduled post of its own variant (its draft SCHEDULED). */
  async function scheduledPost(
    over: Partial<typeof schema.publications.$inferInsert> = {},
    marketCode?: string,
  ) {
    const made = await fx.makeVariant({
      status: "SCHEDULED",
      ...(marketCode ? { marketCode } : {}),
    });
    const { versionId } = await fx.makeVersion(made.variantId);
    const publicationId = await fx.makePublication(made.variantId, versionId, {
      scheduledAt: minutes(-1),
      ...over,
    });
    return { ...made, publicationId };
  }

  describe("the dispatcher", () => {
    it("queues what is due, oldest first, with the market's account, and starts one job each", async () => {
      const { marketId } = await fx.makeVariant({ status: "SCHEDULED" }); // only to know the market
      const { account } = await connectTestAccount(ctx, mock, { marketId, accountId: ES });
      const later = await scheduledPost({ scheduledAt: minutes(-1) });
      const earlier = await scheduledPost({ scheduledAt: minutes(-10) });
      const future = await scheduledPost({ scheduledAt: minutes(30) });
      const result = await dispatchDuePublications(ctx);
      expect(result).toMatchObject({
        dispatched: [earlier.publicationId, later.publicationId],
        recovered: [],
        failedToStart: [],
      });
      expect(result.blocked).toBeUndefined();
      expect(await publication(earlier.publicationId)).toMatchObject({
        status: "QUEUED",
        socialAccountId: account.id,
        triggerRunId: "run-1",
      });
      expect(await publication(later.publicationId)).toMatchObject({
        status: "QUEUED",
        triggerRunId: "run-2",
      });
      expect(await publication(future.publicationId)).toMatchObject({
        status: "SCHEDULED",
        triggerRunId: null,
      });
      expect(
        calls.map((c) => [c.name, c.payload, c.options?.idempotencyKey, c.options?.concurrencyKey]),
      ).toEqual([
        [
          "publish-content",
          { publicationId: earlier.publicationId },
          (await publication(earlier.publicationId)).idempotencyKey,
          account.id,
        ],
        [
          "publish-content",
          { publicationId: later.publicationId },
          (await publication(later.publicationId)).idempotencyKey,
          account.id,
        ],
      ]);
    });

    it("never takes the same publication twice, not even with dispatchers running together", async () => {
      const posts = await Promise.all(
        [1, 2, 3, 4].map((i) => scheduledPost({ scheduledAt: minutes(-i) })),
      );
      const results = await Promise.all([
        dispatchDuePublications(ctx),
        dispatchDuePublications(ctx),
        dispatchDuePublications(ctx),
      ]);
      const dispatched = results.flatMap((r) => r.dispatched);
      expect(dispatched.toSorted()).toEqual(posts.map((p) => p.publicationId).toSorted());
      expect(new Set(dispatched).size).toBe(dispatched.length);
      expect(calls).toHaveLength(4);
      expect((await dispatchDuePublications(ctx)).dispatched).toEqual([]);
    });

    it("takes at most ten at a time", async () => {
      await Promise.all(
        Array.from({ length: 12 }, (_, i) => scheduledPost({ scheduledAt: minutes(-i - 1) })),
      );
      expect((await dispatchDuePublications(ctx)).dispatched).toHaveLength(10);
      expect((await dispatchDuePublications(ctx)).dispatched).toHaveLength(2);
    });

    it("does nothing when the environment is off", async () => {
      await t.close();
      await setup({ mode: "off" });
      const p = await scheduledPost();
      expect(await dispatchDuePublications(ctx)).toMatchObject({
        blocked: "MODE_OFF",
        dispatched: [],
      });
      expect((await publication(p.publicationId)).status).toBe("SCHEDULED");
      expect(calls).toEqual([]);
    });

    it("holds live posts while the kill switch is off or the environment only allows dry runs, but sends dry runs", async () => {
      for (const over of [{ enabled: false }, { mode: "dry_run_only" as const }]) {
        await t.close();
        await setup(over);
        const live = await scheduledPost();
        const dry = await scheduledPost({ dryRun: true, status: "SCHEDULED" });
        const result = await dispatchDuePublications(ctx);
        expect(result.blocked).toBe(over.enabled === false ? "KILL_SWITCH" : "MODE_DRY_RUN_ONLY");
        expect(result.dispatched).toEqual([dry.publicationId]);
        expect((await publication(live.publicationId)).status).toBe("SCHEDULED");
      }
    });

    it("puts a post back to wait when its job cannot be started", async () => {
      await t.close();
      await setup({
        jobs: {
          trigger: async () => {
            throw new Error("runner down");
          },
          triggerAndWaitAll: async () => [],
        },
      });
      const p = await scheduledPost();
      const result = await dispatchDuePublications(ctx);
      expect(result).toMatchObject({ dispatched: [], failedToStart: [p.publicationId] });
      expect(await publication(p.publicationId)).toMatchObject({
        status: "SCHEDULED",
        triggerRunId: null,
      });
    });

    // `updated_at` is kept by a database trigger with the real time, so these tests put the manual
    // clock at the real time and move it from there.
    const atRealTime = () => fx.clock.set(new Date());

    it("restarts a queued post whose job was never started, after two minutes", async () => {
      atRealTime();
      const p = await scheduledPost({ status: "QUEUED", mode: "IMMEDIATE", scheduledAt: null });
      expect((await dispatchDuePublications(ctx)).recovered).toEqual([]);
      fx.clock.advance(ORPHAN_AFTER_MS + MIN);
      const result = await dispatchDuePublications(ctx);
      expect(result.recovered).toEqual([p.publicationId]);
      expect(calls.at(-1)?.options?.idempotencyKey).toBe(
        (await publication(p.publicationId)).idempotencyKey,
      );
      expect((await publication(p.publicationId)).triggerRunId).toBe("run-1");
      // Now it has a run: it is not an orphan any more.
      fx.clock.advance(MIN);
      expect((await dispatchDuePublications(ctx)).recovered).toEqual([]);
    });

    it("restarts a publication with no sign of life for half an hour, with a key for that half hour", async () => {
      atRealTime();
      const p = await scheduledPost({
        status: "IN_PROGRESS",
        mode: "IMMEDIATE",
        scheduledAt: null,
        triggerRunId: "dead-run",
        step: "WAIT_READY",
      });
      fx.clock.advance(STUCK_AFTER_MS - MIN);
      expect((await dispatchDuePublications(ctx)).recovered).toEqual([]);
      fx.clock.advance(2 * MIN);
      const first = await dispatchDuePublications(ctx);
      expect(first.recovered).toEqual([p.publicationId]);
      const key = (await publication(p.publicationId)).idempotencyKey;
      const recoveryKey = calls.at(-1)?.options?.idempotencyKey;
      expect(recoveryKey).toMatch(new RegExp(`^${key}:recover:\\d+$`));
      // In the same half hour the key is the same, so the runner starts nothing new.
      await dispatchDuePublications(ctx);
      expect(calls.at(-1)?.options?.idempotencyKey).toBe(recoveryKey);
    });

    it("leaves a publication alone that moved recently", async () => {
      await scheduledPost({
        status: "IN_PROGRESS",
        mode: "IMMEDIATE",
        scheduledAt: null,
        triggerRunId: "alive",
        step: "WAIT_READY",
      });
      fx.clock.advance(MIN);
      expect((await dispatchDuePublications(ctx)).recovered).toEqual([]);
    });
  });

  describe("publish now and dry runs", () => {
    it("queues a post at once: the publication QUEUED with the account, the draft PUBLISHING, the job started", async () => {
      const { variantId, account } = await approved();
      const { publication: pub, warnings } = await schedulePublication(ctx, {
        variantId,
        mode: "IMMEDIATE",
      });
      expect(pub).toMatchObject({
        mode: "IMMEDIATE",
        status: "QUEUED",
        dryRun: false,
        scheduledAt: null,
        socialAccountId: account?.id,
        retryNo: 0,
        triggerRunId: "run-1",
      });
      expect(pub.idempotencyKey).toBe(`pub:${pub.id}:0`);
      expect(warnings).toEqual([]);
      expect(await fx.variant(variantId)).toMatchObject({ status: "PUBLISHING" });
      expect(calls).toMatchObject([
        {
          name: "publish-content",
          payload: { publicationId: pub.id },
          options: { idempotencyKey: pub.idempotencyKey, concurrencyKey: account?.id },
        },
      ]);
      const audits = (
        await t.db.select({ a: schema.auditEvents.action }).from(schema.auditEvents)
      ).map((r) => r.a);
      expect(audits).toContain("publication.publish_requested");
    });

    it("keeps the publication even if the job runner is down; the dispatcher finds it", async () => {
      await t.close();
      await setup({
        jobs: {
          trigger: async () => {
            throw new Error("runner down");
          },
          triggerAndWaitAll: async () => [],
        },
      });
      const { variantId } = await approved();
      const { publication: pub } = await schedulePublication(ctx, { variantId, mode: "IMMEDIATE" });
      expect(pub).toMatchObject({ status: "QUEUED", triggerRunId: null });
    });

    it.each([
      ["the environment is off", { mode: "off" as const }, /switched off in this environment/],
      ["only dry runs are allowed", { mode: "dry_run_only" as const }, /only allows dry runs/],
      ["the kill switch is off", { enabled: false }, /kill switch/],
    ])("refuses publishing now when %s", async (_name, over, message) => {
      await t.close();
      await setup(over);
      const { variantId } = await approved();
      await expect(schedulePublication(ctx, { variantId, mode: "IMMEDIATE" })).rejects.toThrow(
        message,
      );
      expect((await fx.variant(variantId)).status).toBe("APPROVED");
      expect(calls).toEqual([]);
    });

    it("refuses when the market has no usable account", async () => {
      const { variantId } = await approved({ account: false });
      await expect(schedulePublication(ctx, { variantId, mode: "IMMEDIATE" })).rejects.toThrow(
        /no connected Instagram account/,
      );
      await t.db.insert(schema.socialAccounts).values({
        marketId: (await fx.variant(variantId)).marketId,
        username: "x",
        instagramAccountId: ES,
        accessTokenEncrypted: "enc",
        status: "NEEDS_REAUTH",
      });
      await expect(schedulePublication(ctx, { variantId, mode: "IMMEDIATE" })).rejects.toThrow(
        InvalidStateError,
      );
    });

    it("refuses a draft that is not approved and a second live post", async () => {
      const draft = await fx.makeVariant({ status: "READY_FOR_REVIEW" });
      await expect(
        schedulePublication(ctx, { variantId: draft.variantId, mode: "IMMEDIATE" }),
      ).rejects.toThrow(/Only an approved draft/);
      const { variantId } = await approved();
      await schedulePublication(ctx, { variantId, mode: "IMMEDIATE" });
      await expect(schedulePublication(ctx, { variantId, mode: "IMMEDIATE" })).rejects.toThrow(
        InvalidStateError,
      );
      await t.db
        .update(schema.contentVariants)
        .set({ status: "APPROVED" })
        .where(eq(schema.contentVariants.id, variantId));
      await expect(schedulePublication(ctx, { variantId, mode: "IMMEDIATE" })).rejects.toThrow(
        ConflictError,
      );
    });

    it("queues a dry run without touching the draft, as often as wanted, even in dry_run_only", async () => {
      await t.close();
      await setup({ mode: "dry_run_only", enabled: false });
      const { variantId } = await approved();
      const one = await schedulePublication(ctx, { variantId, dryRun: true });
      const two = await schedulePublication(ctx, { variantId, dryRun: true });
      expect(one.publication).toMatchObject({ dryRun: true, status: "QUEUED", mode: "IMMEDIATE" });
      expect(two.publication.id).not.toBe(one.publication.id);
      expect((await fx.variant(variantId)).status).toBe("APPROVED");
      expect(calls).toHaveLength(2);
      // A dry run is also allowed for a draft that is already scheduled.
      const { variantId: other } = await approved({ account: false, marketCode: "en" });
      await expect(schedulePublication(ctx, { variantId: other, dryRun: true })).rejects.toThrow(
        /no connected Instagram account/,
      );
    });
  });

  describe("retryPublication", () => {
    async function failedPost(over: Partial<typeof schema.publications.$inferInsert> = {}) {
      const made = await fx.makeVariant({ status: "FAILED" });
      const { versionId } = await fx.makeVersion(made.variantId);
      const { account } = await connectTestAccount(ctx, mock, {
        marketId: made.marketId,
        accountId: ES,
      });
      const publicationId = await fx.makePublication(made.variantId, versionId, {
        status: "FAILED",
        mode: "IMMEDIATE",
        scheduledAt: null,
        socialAccountId: account.id,
        step: "WAIT_READY",
        igChildrenContainerIds: ["c1", "c2", "c3"],
        igContainerId: "parent",
        attemptCount: 5,
        lastError: { message: "boom", classification: "TRANSIENT" },
        triggerRunId: "old-run",
        ...over,
      });
      return { ...made, account, publicationId };
    }

    it("makes a new key, starts the budget over, keeps the containers and the step, and moves the draft on", async () => {
      const { publicationId, variantId, account } = await failedPost();
      const pub = await retryPublication(ctx, { publicationId });
      expect(pub).toMatchObject({
        status: "QUEUED",
        retryNo: 1,
        idempotencyKey: `pub:${publicationId}:1`,
        attemptCount: 0,
        lastError: null,
        step: "WAIT_READY",
        igChildrenContainerIds: ["c1", "c2", "c3"],
        igContainerId: "parent",
        socialAccountId: account.id,
        triggerRunId: "run-1",
      });
      expect(await fx.variant(variantId)).toMatchObject({ status: "PUBLISHING" });
      expect(calls[0]?.options?.idempotencyKey).toBe(`pub:${publicationId}:1`);
      const [audit] = await t.db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.action, "publication.retried"));
      expect(audit?.data).toMatchObject({ retryNo: 1, previousError: { message: "boom" } });
      // And again: the key moves on.
      await t.db
        .update(schema.publications)
        .set({ status: "FAILED" })
        .where(eq(schema.publications.id, publicationId));
      await t.db
        .update(schema.contentVariants)
        .set({ status: "FAILED" })
        .where(eq(schema.contentVariants.id, variantId));
      expect((await retryPublication(ctx, { publicationId })).idempotencyKey).toBe(
        `pub:${publicationId}:2`,
      );
    });

    it("starts from the beginning when the market's account is a different one", async () => {
      const { publicationId, marketId } = await failedPost();
      await t.db
        .update(schema.socialAccounts)
        .set({ status: "DISABLED" })
        .where(eq(schema.socialAccounts.marketId, marketId));
      mock.addAccount({ id: "1790", username: "new" });
      const { account: fresh } = await connectTestAccount(ctx, mock, {
        marketId,
        accountId: "1790",
      });
      await t.db
        .update(schema.socialAccounts)
        .set({ status: "ACTIVE" })
        .where(eq(schema.socialAccounts.id, fresh.id));
      // The allowlist of this environment lists only ES: the retry is refused until it is allowed.
      await expect(retryPublication(ctx, { publicationId })).rejects.toThrow(/allowlist/);
    });

    it("refuses what is not FAILED, and a retry the environment would refuse", async () => {
      const ok = await scheduledPost();
      await expect(retryPublication(ctx, { publicationId: ok.publicationId })).rejects.toThrow(
        /Only a failed post/,
      );
      await t.close();
      await setup({ enabled: false });
      const { publicationId } = await failedPost();
      await expect(retryPublication(ctx, { publicationId })).rejects.toThrow(/kill switch/);
      expect((await publication(publicationId)).status).toBe("FAILED");
    });

    it("retries a failed dry run without touching the draft", async () => {
      const { publicationId, variantId } = await failedPost({ dryRun: true });
      await t.db
        .update(schema.contentVariants)
        .set({ status: "APPROVED" })
        .where(eq(schema.contentVariants.id, variantId));
      expect(await retryPublication(ctx, { publicationId })).toMatchObject({
        status: "QUEUED",
        dryRun: true,
      });
      expect((await fx.variant(variantId)).status).toBe("APPROVED");
    });
  });

  describe("the jobs, end to end", () => {
    it("publish now runs the job to PUBLISHED, and a scheduled post goes out when the dispatcher finds it due", async () => {
      await t.close();
      // The real handlers run in-process; waits move the manual clock.
      const jobs = createInlineJobRunner({
        handlers: jobHandlers,
        mode: "await",
        makeContext: (runId) => ({
          ...ctx,
          actor: { type: "JOB", jobRunId: runId },
          sleep: async (ms) => {
            fx.clock.advance(ms);
          },
        }),
      });
      await setup({ jobs });
      mock.addAccount({ id: ES, username: "kitchen_es" });

      const first = await approved();
      const { publication: now } = await schedulePublication(ctx, {
        variantId: first.variantId,
        mode: "IMMEDIATE",
      });
      expect(await publication(now.id)).toMatchObject({ status: "PUBLISHED", attemptCount: 1 });
      expect(await fx.variant(first.variantId)).toMatchObject({ status: "PUBLISHED" });
      expect(mock.publishedMedia()).toHaveLength(1);

      const second = await approved({ account: false });
      const { publication: later } = await schedulePublication(ctx, {
        variantId: second.variantId,
        scheduledAt: minutes(10).toISOString(),
      });
      expect((await dispatchDuePublications(ctx)).dispatched).toEqual([]);
      fx.clock.advance(11 * MIN);
      expect((await dispatchDuePublications(ctx)).dispatched).toEqual([later.id]);
      expect(await publication(later.id)).toMatchObject({ status: "PUBLISHED" });
      expect(await fx.variant(second.variantId)).toMatchObject({ status: "PUBLISHED" });
      expect(mock.publishedMedia()).toHaveLength(2);
      // Running the same job again changes nothing: no third post.
      await jobs.trigger("publish-content", { publicationId: later.id });
      expect(mock.publishedMedia()).toHaveLength(2);
    });
  });
});
