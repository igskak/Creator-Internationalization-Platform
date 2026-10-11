import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { TransientError } from "@rc/lib/errors";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ReviewFixture, reviewFixture } from "../content/variants/test-support";
import type { ServiceContext } from "../core";
import { connectTestAccount, mockRuntime, newMock } from "../instagram/test-support";
import { MAX_PUBLISH_ATTEMPTS, runPublication } from "./publish-machine";

// The publish state machine (M5-06): every path of plan 13 §13.3.

const ES_ACCOUNT = "1784";
const EN_ACCOUNT = "1785";

describe("publish machine", () => {
  let t: TestDb;
  let fx: ReviewFixture;
  let mock: ReturnType<typeof newMock>;
  let jobCtx: ServiceContext;
  let sleeps: number[];

  type Setup = {
    mode?: "live" | "dry_run_only" | "off";
    allowlist?: string[];
    enabled?: boolean;
  };

  /** A fixture, the mock and a JOB context whose sleep advances the manual clock. */
  async function setup(over: Setup = {}) {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    mock = newMock({ accounts: [], now: () => fx.clock.now() });
    const runtime = mockRuntime(mock, {
      publishMode: over.mode ?? "live",
      allowlist: over.allowlist ?? [ES_ACCOUNT],
    });
    fx = await reviewFixture(t.db, { instagram: runtime });
    sleeps = [];
    jobCtx = {
      ...fx.ctx,
      actor: { type: "JOB", jobRunId: "run-1" },
      sleep: async (ms) => {
        sleeps.push(ms);
        fx.clock.advance(ms);
      },
    };
    await t.db
      .insert(schema.appSettings)
      .values({ key: "publishing.enabled", value: over.enabled ?? true })
      .onConflictDoUpdate({
        target: schema.appSettings.key,
        set: { value: over.enabled ?? true },
      });
  }
  beforeEach(async () => {
    await setup();
  });
  afterEach(async () => {
    await t.close();
  });

  const as = (runId: string): ServiceContext => ({
    ...jobCtx,
    actor: { type: "JOB", jobRunId: runId },
  });

  /** A live post ready to go: SCHEDULED variant, its approved version, a QUEUED publication. */
  async function queued(
    opts: {
      dryRun?: boolean;
      marketCode?: string;
      account?: boolean;
      accountId?: string;
      over?: Partial<typeof schema.publications.$inferInsert>;
    } = {},
  ) {
    const { variantId, marketId } = await fx.makeVariant({
      status: opts.dryRun ? "APPROVED" : "SCHEDULED",
      ...(opts.marketCode ? { marketCode: opts.marketCode } : {}),
    });
    const { versionId } = await fx.makeVersion(variantId);
    if (opts.account !== false) {
      await connectTestAccount(fx.ctx, mock, {
        marketId,
        accountId: opts.accountId ?? ES_ACCOUNT,
        username: "kitchen_es",
      });
    }
    const publicationId = await fx.makePublication(variantId, versionId, {
      status: "QUEUED",
      mode: "IMMEDIATE",
      dryRun: opts.dryRun ?? false,
      ...opts.over,
    });
    return { variantId, marketId, versionId, publicationId };
  }

  const publication = async (id: string) =>
    (
      await t.db.select().from(schema.publications).where(eq(schema.publications.id, id))
    )[0] as typeof schema.publications.$inferSelect;
  const variantOf = (id: string) => fx.variant(id);
  const attempts = (id: string) =>
    t.db
      .select()
      .from(schema.publishAttempts)
      .where(eq(schema.publishAttempts.publicationId, id))
      .orderBy(schema.publishAttempts.id);
  const audits = async () =>
    (await t.db.select({ action: schema.auditEvents.action }).from(schema.auditEvents)).map(
      (a) => a.action,
    );
  const graphCalls = () => mock.calls.filter((c) => !c.path.includes("oauth"));

  it("publishes a carousel: children, parent, wait, publish, finalize", async () => {
    const { variantId, publicationId } = await queued();
    mock.addAccount({ id: ES_ACCOUNT, username: "kitchen_es", followers: 4321 });
    const outcome = await runPublication(jobCtx, { publicationId });
    expect(outcome).toMatchObject({ status: "PUBLISHED" });
    const pub = await publication(publicationId);
    expect(pub).toMatchObject({
      status: "PUBLISHED",
      step: "FINALIZE",
      attemptCount: 1,
      followerCountAtPublish: 4321,
      lastError: null,
      triggerRunId: "run-1",
    });
    expect(pub.instagramMediaId).toBeTruthy();
    expect(pub.permalink).toContain("instagram.com/p/");
    expect(pub.publishedAt).toBeInstanceOf(Date);
    expect(pub.igChildrenContainerIds).toHaveLength(3);
    expect(pub.socialAccountId).not.toBeNull();
    expect(await variantOf(variantId)).toMatchObject({ status: "PUBLISHED" });

    // The Graph calls, in order, with the right arguments.
    const calls = graphCalls().map((c) => `${c.method} ${c.path}`);
    expect(calls).toEqual([
      `GET /${ES_ACCOUNT}/content_publishing_limit`,
      `POST /${ES_ACCOUNT}/media`,
      `POST /${ES_ACCOUNT}/media`,
      `POST /${ES_ACCOUNT}/media`,
      expect.stringMatching(/^GET \/179\d+$/),
      expect.stringMatching(/^GET \/179\d+$/),
      expect.stringMatching(/^GET \/179\d+$/),
      `POST /${ES_ACCOUNT}/media`,
      expect.stringMatching(/^GET \/178\d+$/),
      expect.stringMatching(/^GET \/178\d+$/),
      `POST /${ES_ACCOUNT}/media_publish`,
      expect.stringMatching(/^GET \/180\d+$/),
      "GET /me",
    ]);
    const children = mock.calls.filter(
      (c) => c.method === "POST" && c.body.is_carousel_item === true,
    );
    expect(children.map((c) => String(c.body.image_url).includes("renders/"))).toEqual([
      true,
      true,
      true,
    ]);
    const parent = mock.calls.find((c) => c.body.media_type === "CAROUSEL");
    expect(parent?.body.children).toBe(pub.igChildrenContainerIds.join(","));
    expect(parent?.body.caption).toBe("Un pie de foto.\n\n#cocina");
    expect(parent?.body).not.toHaveProperty("is_ai_generated");
    expect(mock.calls.every((c) => c.authorization?.startsWith("Bearer "))).toBe(true);

    // One attempt row per call, path-only endpoints, no signed URL or token anywhere.
    const rows = await attempts(publicationId);
    expect(rows).toHaveLength(calls.length);
    expect(rows.every((r) => r.outcome === "OK")).toBe(true);
    expect(rows.find((r) => r.endpoint.endsWith("/media_publish"))).toMatchObject({
      step: "PUBLISH",
      request: { creation_id: pub.igContainerId },
      httpStatus: 200,
    });
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain("expires=");
    expect(stored).not.toContain("Bearer");
    expect(stored).not.toMatch(/igl-\d+-/);
    expect(rows.every((r) => !r.endpoint.includes("?"))).toBe(true);
    expect(await audits()).toEqual(
      expect.arrayContaining([
        "variant.publishing_started",
        "variant.published",
        "publication.published",
      ]),
    );
  });

  it("does nothing the second time a finished publication is run (the idempotency drill)", async () => {
    const { publicationId } = await queued();
    mock.addAccount({ id: ES_ACCOUNT, username: "kitchen_es" });
    await runPublication(jobCtx, { publicationId });
    const callsBefore = mock.calls.length;
    for (const runId of ["run-2", "run-3"]) {
      expect(await runPublication(as(runId), { publicationId })).toEqual({
        status: "NOOP",
        publicationStatus: "PUBLISHED",
      });
    }
    expect(mock.calls.length).toBe(callsBefore);
    expect(mock.publishedMedia()).toHaveLength(1);
  });

  it("waits while Instagram processes the container, polling every 30 s and then every 60 s", async () => {
    mock.options.finishAfterPolls = 9;
    const { publicationId } = await queued();
    mock.addAccount({ id: ES_ACCOUNT, username: "kitchen_es" });
    // The parent is polled once to see it is IN_PROGRESS, then the machine waits.
    await runPublication(jobCtx, { publicationId });
    expect(sleeps).toEqual([30_000, 30_000, 30_000, 30_000, 30_000, 30_000, 60_000, 60_000]);
    expect((await publication(publicationId)).status).toBe("PUBLISHED");
  });

  it("gives up waiting after ten minutes and retries from WAIT_READY without making new containers", async () => {
    mock.options.finishAfterPolls = 1000;
    const { publicationId } = await queued();
    mock.addAccount({ id: ES_ACCOUNT, username: "kitchen_es" });
    const failure = await runPublication(jobCtx, { publicationId }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(TransientError);
    const stuck = await publication(publicationId);
    expect(stuck).toMatchObject({ status: "IN_PROGRESS", step: "WAIT_READY" });
    const containersBefore = mock.containers.size;
    mock.options.finishAfterPolls = 1;
    for (const c of mock.containers.values()) if (c.kind === "CAROUSEL") c.polls = 5;
    await runPublication(as("run-2"), { publicationId });
    expect(mock.containers.size).toBe(containersBefore);
    expect(await publication(publicationId)).toMatchObject({
      status: "PUBLISHED",
      attemptCount: 2,
    });
  });

  it("makes the containers again once after they expired, and fails the second time", async () => {
    const { publicationId, variantId } = await queued();
    mock.addAccount({ id: ES_ACCOUNT, username: "kitchen_es" });
    // The container expires before the first poll.
    let first = true;
    const original = mock.handle;
    mock.handle = async (request) => {
      const response = await original(request);
      if (first && new URL(request.url).pathname.match(/\/178\d+$/)) {
        first = false;
        for (const c of mock.containers.values()) if (c.kind === "CAROUSEL") c.status = "EXPIRED";
        return Response.json({ status_code: "EXPIRED" });
      }
      return response;
    };
    const rt = mockRuntime(mock);
    const ctx = {
      ...jobCtx,
      instagram: {
        ...rt,
        fetch: (async (i: string | URL | Request, init?: RequestInit) =>
          mock.handle(new Request(i, init))) as typeof fetch,
        app: rt.app && { ...rt.app, accountAllowlist: [ES_ACCOUNT] },
      },
    };
    const outcome = await runPublication(ctx, { publicationId });
    expect(outcome.status).toBe("PUBLISHED");
    expect(mock.containers.size).toBe(3 + 1 + 3 + 1); // two sets of children and parents
    expect(await variantOf(variantId)).toMatchObject({ status: "PUBLISHED" });
  });

  it("fails with INVALID_MEDIA when the container goes to ERROR, and the draft FAILS with it", async () => {
    const { publicationId, variantId } = await queued();
    mock.addAccount({ id: ES_ACCOUNT, username: "kitchen_es" });
    const original = mock.handle;
    mock.handle = async (request) => {
      if (new URL(request.url).pathname.match(/\/178\d+$/))
        return Response.json({ status_code: "ERROR", status: "Error: aspect ratio" });
      return original(request);
    };
    const rt = mockRuntime(mock);
    const ctx = {
      ...jobCtx,
      instagram: {
        ...rt,
        fetch: (async (i: string | URL | Request, init?: RequestInit) =>
          mock.handle(new Request(i, init))) as typeof fetch,
        app: rt.app && { ...rt.app, accountAllowlist: [ES_ACCOUNT] },
      },
    };
    const outcome = await runPublication(ctx, { publicationId });
    expect(outcome).toMatchObject({ status: "FAILED", error: { classification: "INVALID_MEDIA" } });
    expect((await publication(publicationId)).lastError).toMatchObject({
      classification: "INVALID_MEDIA",
    });
    expect(await variantOf(variantId)).toMatchObject({ status: "FAILED" });
    expect(await audits()).toContain("publication.failed");
    expect(mock.callsTo(/media_publish/)).toHaveLength(0);
  });

  it("marks the account NEEDS_REAUTH and fails on error 190, without retrying", async () => {
    const { publicationId, variantId } = await queued();
    mock.addAccount({ id: ES_ACCOUNT, username: "kitchen_es" });
    mock.fail({
      method: "POST",
      path: /\/media$/,
      skip: 1,
      status: 400,
      error: { message: "Error validating access token", code: 190, error_subcode: 463 },
    });
    const outcome = await runPublication(jobCtx, { publicationId });
    expect(outcome).toMatchObject({
      status: "FAILED",
      error: { classification: "AUTH", code: 190 },
    });
    const [account] = await t.db.select().from(schema.socialAccounts);
    expect(account).toMatchObject({ status: "NEEDS_REAUTH", tokenStatus: "INVALID" });
    expect(await variantOf(variantId)).toMatchObject({ status: "FAILED" });
    expect((await attempts(publicationId)).at(-1)).toMatchObject({
      outcome: "PERMANENT_ERROR",
      errorCode: "190",
      errorSubcode: "463",
    });
  });

  it("retries a rate limit: the run throws, the progress is kept, the next run continues", async () => {
    const { publicationId } = await queued();
    mock.addAccount({ id: ES_ACCOUNT, username: "kitchen_es" });
    // The second child hits the rate limit.
    mock.fail({
      method: "POST",
      path: /\/media$/,
      skip: 1,
      status: 400,
      error: { message: "Application request limit reached", code: 4 },
    });
    const failure = await runPublication(jobCtx, { publicationId }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(TransientError);
    expect(failure).toMatchObject({ code: "RATE_LIMITED", retryAfterMs: 5 * 60_000 });
    const mid = await publication(publicationId);
    expect(mid).toMatchObject({ status: "IN_PROGRESS", step: "CREATE_CHILDREN" });
    expect(mid.igChildrenContainerIds).toHaveLength(1);
    expect((await attempts(publicationId)).at(-1)).toMatchObject({
      outcome: "TRANSIENT_ERROR",
      errorCode: "4",
    });

    const done = await runPublication(as("run-2"), { publicationId });
    expect(done.status).toBe("PUBLISHED");
    const after = await publication(publicationId);
    expect(after.igChildrenContainerIds).toHaveLength(3);
    expect(after.igChildrenContainerIds[0]).toBe(mid.igChildrenContainerIds[0]);
    // 3 children and 1 parent in total: the first child was not made again.
    expect(mock.callsTo(/\/media$/, "POST")).toHaveLength(1 + 1 + 3 - 1 + 1);
    expect(mock.publishedMedia()).toHaveLength(1);
  });

  it("fails after the last attempt instead of throwing again", async () => {
    const { publicationId, variantId } = await queued();
    mock.addAccount({ id: ES_ACCOUNT, username: "kitchen_es" });
    mock.fail({
      path: /content_publishing_limit/,
      status: 503,
      error: { message: "down", code: 2 },
      times: 99,
    });
    for (let run = 1; run < MAX_PUBLISH_ATTEMPTS; run += 1) {
      await expect(runPublication(as(`run-${run}`), { publicationId })).rejects.toBeInstanceOf(
        TransientError,
      );
      expect((await publication(publicationId)).status).toBe("IN_PROGRESS");
    }
    const last = await runPublication(as("run-last"), { publicationId });
    expect(last).toMatchObject({ status: "FAILED", error: { classification: "TRANSIENT" } });
    expect((await publication(publicationId)).attemptCount).toBe(MAX_PUBLISH_ATTEMPTS);
    expect(await variantOf(variantId)).toMatchObject({ status: "FAILED" });
  });

  it("makes the link again once when Meta cannot download an image, then stops", async () => {
    const { publicationId } = await queued();
    mock.addAccount({ id: ES_ACCOUNT, username: "kitchen_es" });
    mock.fail({
      method: "POST",
      path: /\/media$/,
      status: 400,
      error: {
        message: "Media upload has failed: could not download the image",
        code: 100,
        error_subcode: 2207003,
      },
    });
    expect((await runPublication(jobCtx, { publicationId })).status).toBe("PUBLISHED");
    // The first child was asked for twice (once refused, once made).
    expect(
      mock.callsTo(/\/media$/, "POST").filter((c) => c.body.is_carousel_item === true),
    ).toHaveLength(4);
  });

  it("stops when the download keeps failing", async () => {
    const { publicationId } = await queued();
    mock.addAccount({ id: ES_ACCOUNT, username: "kitchen_es" });
    mock.fail({
      method: "POST",
      path: /\/media$/,
      status: 400,
      error: {
        message: "Media upload has failed: could not download the image",
        code: 100,
        error_subcode: 2207003,
      },
      times: 2,
    });
    const outcome = await runPublication(jobCtx, { publicationId });
    expect(outcome).toMatchObject({
      status: "FAILED",
      error: { classification: "INVALID_MEDIA", subcode: 2207003 },
    });
    expect(mock.callsTo(/\/media$/, "POST")).toHaveLength(2);
  });

  describe("an unknown result of media_publish", () => {
    it("reconciles after a dropped answer: the post is found, no second publish", async () => {
      const { publicationId, variantId } = await queued();
      mock.addAccount({ id: ES_ACCOUNT, username: "kitchen_es" });
      mock.fail({ method: "POST", path: /media_publish$/, dropAfterEffect: true });
      const outcome = await runPublication(jobCtx, { publicationId });
      expect(outcome.status).toBe("PUBLISHED");
      expect(mock.callsTo(/media_publish$/, "POST")).toHaveLength(1);
      expect(mock.publishedMedia()).toHaveLength(1);
      const pub = await publication(publicationId);
      expect(pub.instagramMediaId).toBe(mock.publishedMedia()[0]?.id);
      expect(await variantOf(variantId)).toMatchObject({ status: "PUBLISHED" });
      const publishRow = (await attempts(publicationId)).find((r) =>
        r.endpoint.endsWith("/media_publish"),
      );
      expect(publishRow).toMatchObject({ outcome: "OK", response: { reconciled: "published" } });
    });

    /** A worker that sent media_publish and died: the post is live, the attempt row is AMBIGUOUS. */
    async function deadWorker() {
      const made = await queued();
      mock.addAccount({ id: ES_ACCOUNT, username: "kitchen_es" });
      mock.fail({ method: "POST", path: /media_publish$/, dropAfterEffect: true });
      // Every status read after the publish call fails too, so the run cannot find out itself.
      mock.fail({ method: "GET", path: /^\/178\d+$/, skip: 2, dropBeforeEffect: true, times: 99 });
      await expect(
        runPublication(jobCtx, { publicationId: made.publicationId }),
      ).rejects.toBeInstanceOf(TransientError);
      mock.clearFaults();
      const mid = await publication(made.publicationId);
      expect(mid).toMatchObject({ status: "IN_PROGRESS", step: "PUBLISH", instagramMediaId: null });
      expect(mock.publishedMedia()).toHaveLength(1);
      expect(
        (await attempts(made.publicationId)).find((r) => r.endpoint.endsWith("/media_publish"))
          ?.outcome,
      ).toBe("AMBIGUOUS");
      return made;
    }

    it("recovers when a worker died after the call: a later run finds the post and does not publish again", async () => {
      const { publicationId, variantId } = await deadWorker();
      fx.clock.advance(5 * 60_000);
      const outcome = await runPublication(as("run-2"), { publicationId });
      expect(outcome.status).toBe("PUBLISHED");
      expect(mock.publishedMedia()).toHaveLength(1);
      expect(mock.callsTo(/media_publish$/, "POST")).toHaveLength(1);
      const pub = await publication(publicationId);
      expect(pub.instagramMediaId).toBe(mock.publishedMedia()[0]?.id);
      expect(pub.attemptCount).toBe(2);
      expect(await variantOf(variantId)).toMatchObject({ status: "PUBLISHED" });
    });

    it("steps aside while another run's call is young and the container still says FINISHED", async () => {
      const { publicationId } = await deadWorker();
      // As if the other call had not landed yet.
      for (const c of mock.containers.values()) if (c.kind === "CAROUSEL") c.status = "FINISHED";
      // A young AMBIGUOUS row of another run, and the first row of this run resolved away.
      const callsBefore = mock.callsTo(/media_publish$/, "POST").length;
      // The unresolved attempt makes the machine reconcile first: FINISHED means "not published",
      // so it would publish again... unless the call is young: the lease is checked first.
      await t.db
        .update(schema.publishAttempts)
        .set({ triggerRunId: "someone-else" })
        .where(eq(schema.publishAttempts.endpoint, `/${ES_ACCOUNT}/media_publish`));
      const outcome = await runPublication(as("run-2"), { publicationId });
      expect(outcome).toEqual({ status: "IN_FLIGHT" });
      expect(mock.callsTo(/media_publish$/, "POST")).toHaveLength(callsBefore);
    });

    it("publishes again when the earlier call did not take effect (container still FINISHED)", async () => {
      const { publicationId } = await queued();
      mock.addAccount({ id: ES_ACCOUNT, username: "kitchen_es" });
      mock.fail({ method: "POST", path: /media_publish$/, dropBeforeEffect: true });
      const outcome = await runPublication(jobCtx, { publicationId }).catch((e: unknown) => e);
      // Reconciliation saw FINISHED: nothing happened, the run is retried.
      expect(outcome).toBeInstanceOf(TransientError);
      expect(mock.publishedMedia()).toHaveLength(0);
      const done = await runPublication(as("run-2"), { publicationId });
      expect(done.status).toBe("PUBLISHED");
      expect(mock.publishedMedia()).toHaveLength(1);
      const rows = (await attempts(publicationId)).filter((r) =>
        r.endpoint.endsWith("/media_publish"),
      );
      expect(rows.map((r) => r.outcome)).toEqual(["TRANSIENT_ERROR", "OK"]);
    });

    it("does not publish when a 5xx hides the result and the post cannot be found: manual check", async () => {
      const { publicationId, variantId } = await queued();
      mock.addAccount({ id: ES_ACCOUNT, username: "kitchen_es" });
      // The post goes out, but its caption is not what we sent (someone edited it): no match.
      mock.fail({ method: "POST", path: /media_publish$/, dropAfterEffect: true });
      const original = mock.handle;
      mock.handle = async (request) => {
        const url = new URL(request.url);
        if (
          request.method === "GET" &&
          url.pathname.endsWith("/media") &&
          url.searchParams.get("limit")
        ) {
          return Response.json({
            data: [
              {
                id: "x1",
                caption: "something else",
                timestamp: fx.clock.now().toISOString(),
                permalink: "https://www.instagram.com/p/x1/",
              },
            ],
          });
        }
        return original(request);
      };
      const rt = mockRuntime(mock);
      const ctx = {
        ...jobCtx,
        instagram: {
          ...rt,
          fetch: (async (i: string | URL | Request, init?: RequestInit) =>
            mock.handle(new Request(i, init))) as typeof fetch,
          app: rt.app && { ...rt.app, accountAllowlist: [ES_ACCOUNT] },
        },
      };
      const outcome = await runPublication(ctx, { publicationId });
      expect(outcome).toMatchObject({ status: "FAILED", error: { type: "MANUAL_CHECK_REQUIRED" } });
      expect(mock.callsTo(/media_publish$/, "POST")).toHaveLength(1);
      expect(await variantOf(variantId)).toMatchObject({ status: "FAILED" });
      const [event] = await t.db.select().from(schema.integrationEvents);
      expect(event).toMatchObject({ code: "PUBLISH_MANUAL_CHECK", severity: "ERROR" });
      // Retrying later does not publish blindly either.
      await t.db
        .update(schema.publications)
        .set({ status: "QUEUED" })
        .where(eq(schema.publications.id, publicationId));
      const again = await runPublication(as("run-2"), { publicationId: publicationId });
      expect(mock.callsTo(/media_publish$/, "POST")).toHaveLength(1);
      expect(again.status).toBe("FAILED");
    });
  });

  it("runs a dry run to the end of WAIT_READY: the post is never published and the draft is untouched", async () => {
    const { publicationId, variantId } = await queued({ dryRun: true });
    mock.addAccount({ id: ES_ACCOUNT, username: "kitchen_es" });
    const outcome = await runPublication(jobCtx, { publicationId });
    expect(outcome).toEqual({ status: "DRY_RUN_PASSED" });
    expect(await publication(publicationId)).toMatchObject({
      status: "DRY_RUN_PASSED",
      step: "WAIT_READY",
      instagramMediaId: null,
    });
    expect(await variantOf(variantId)).toMatchObject({ status: "APPROVED" });
    expect(mock.callsTo(/media_publish$/)).toHaveLength(0);
    expect(mock.callsTo(/content_publishing_limit/)).toHaveLength(0);
    expect(mock.publishedMedia()).toHaveLength(0);
    expect(await audits()).toContain("publication.dry_run_passed");
  });

  it("lets a dry run through in dry_run_only mode but not a live post", async () => {
    await t.close();
    await setup({ mode: "dry_run_only" });
    mock.addAccount({ id: ES_ACCOUNT, username: "kitchen_es" });
    const dry = await queued({ dryRun: true });
    expect((await runPublication(jobCtx, { publicationId: dry.publicationId })).status).toBe(
      "DRY_RUN_PASSED",
    );
    const live = await queued({ account: false });
    expect(await runPublication(jobCtx, { publicationId: live.publicationId })).toMatchObject({
      status: "FAILED",
      error: { type: "GUARD_MODE_DRY_RUN_ONLY" },
    });
  });

  describe("safeguards: no Graph call at all", () => {
    const noCalls = () => expect(graphCalls()).toHaveLength(0);
    const failedWith = async (publicationId: string, type: string) => {
      const out = await runPublication(jobCtx, { publicationId });
      expect(out).toMatchObject({
        status: "FAILED",
        error: { type: `GUARD_${type}`, classification: "PERMANENT" },
      });
      noCalls();
      expect((await publication(publicationId)).lastError).toMatchObject({ type: `GUARD_${type}` });
    };

    it("refuses everything when the environment mode is off", async () => {
      await t.close();
      await setup({ mode: "off" });
      const { publicationId } = await queued();
      await failedWith(publicationId, "MODE_OFF");
    });

    it("refuses a live post while the kill switch is off", async () => {
      await t.close();
      await setup({ enabled: false });
      const { publicationId, variantId } = await queued();
      await failedWith(publicationId, "PUBLISHING_OFF");
      expect(await variantOf(variantId)).toMatchObject({ status: "FAILED" });
    });

    it("refuses an account that is not on the allowlist", async () => {
      await t.close();
      await setup({ allowlist: ["somebody-else"] });
      const { publicationId } = await queued();
      await failedWith(publicationId, "NOT_ALLOWLISTED");
    });

    it("refuses to post Spanish content to the English account", async () => {
      await t.close();
      await setup({ allowlist: [ES_ACCOUNT, EN_ACCOUNT] });
      const { publicationId } = await queued({ account: false });
      const [en] = await t.db.select().from(schema.markets).where(eq(schema.markets.code, "en"));
      const { account } = await connectTestAccount(fx.ctx, mock, {
        marketId: en?.id ?? "",
        accountId: EN_ACCOUNT,
      });
      // The publication was pointed at the English account by mistake.
      await t.db
        .update(schema.publications)
        .set({ socialAccountId: account.id })
        .where(eq(schema.publications.id, publicationId));
      await failedWith(publicationId, "MARKET_MISMATCH");
    });

    it("refuses a market without an account", async () => {
      const { publicationId } = await queued({ account: false });
      await failedWith(publicationId, "NO_ACCOUNT");
    });

    it("refuses an account that needs re-auth or has an expired token", async () => {
      const { publicationId, marketId } = await queued();
      await t.db
        .update(schema.socialAccounts)
        .set({ tokenExpiresAt: new Date(fx.clock.now().getTime() - 1000) })
        .where(eq(schema.socialAccounts.marketId, marketId));
      await failedWith(publicationId, "TOKEN_NOT_VALID");
    });

    it("refuses when the draft was changed after the post was planned", async () => {
      const { publicationId, variantId } = await queued();
      await t.db
        .update(schema.contentVariants)
        .set({ approvedVersionId: null })
        .where(eq(schema.contentVariants.id, variantId));
      await failedWith(publicationId, "VERSION_MISMATCH");
    });

    it("refuses a draft that is no longer scheduled", async () => {
      const { publicationId, variantId } = await queued();
      await t.db
        .update(schema.contentVariants)
        .set({ status: "READY_FOR_REVIEW" })
        .where(eq(schema.contentVariants.id, variantId));
      await failedWith(publicationId, "VARIANT_STATE");
    });

    it("refuses when a stored image is not the one that was rendered", async () => {
      const { publicationId, versionId } = await queued();
      const [version] = await t.db
        .select()
        .from(schema.contentVariantVersions)
        .where(eq(schema.contentVariantVersions.id, versionId));
      const key = version?.snapshot.renderedSlideKeys[1] ?? "";
      await fx.storage.put(key, "tampered", { contentType: "image/jpeg" });
      await failedWith(publicationId, "IMAGE_CHANGED");
    });

    it("refuses a render with a wrong size or too few slides", async () => {
      const { publicationId, versionId } = await queued();
      const [version] = await t.db
        .select()
        .from(schema.contentVariantVersions)
        .where(eq(schema.contentVariantVersions.id, versionId));
      await t.db
        .update(schema.renderedSlides)
        .set({ width: 1000 })
        .where(eq(schema.renderedSlides.carouselRenderId, version?.carouselRenderId ?? ""));
      await failedWith(publicationId, "SLIDES_INVALID");
    });

    it("refuses a caption over Instagram's limits", async () => {
      const { publicationId, variantId } = await queued();
      // Edit the approved snapshot's caption in place (it hashes to something else, so recompute).
      const { hashSnapshot } = await import("../content/variants/approve");
      const [version] = await t.db
        .select()
        .from(schema.contentVariantVersions)
        .where(eq(schema.contentVariantVersions.contentVariantId, variantId));
      const snapshot = {
        ...(version?.snapshot as NonNullable<typeof version>["snapshot"]),
        caption: "a".repeat(2300),
      };
      await t.db
        .update(schema.contentVariantVersions)
        .set({ snapshot, contentHash: hashSnapshot(snapshot) })
        .where(eq(schema.contentVariantVersions.id, version?.id ?? ""));
      await failedWith(publicationId, "CAPTION_INVALID");
    });

    it("refuses when Instagram's 24-hour allowance is used up", async () => {
      const { publicationId } = await queued();
      mock.addAccount({ id: ES_ACCOUNT, username: "kitchen_es" });
      mock.quotaUsage = 100;
      const out = await runPublication(jobCtx, { publicationId });
      expect(out).toMatchObject({ status: "FAILED", error: { type: "GUARD_QUOTA_EXHAUSTED" } });
      expect(mock.callsTo(/\/media/, "POST")).toHaveLength(0);
    });

    it("does nothing for a cancelled or not yet released publication", async () => {
      const { publicationId } = await queued({ over: { status: "CANCELLED" } });
      expect(await runPublication(jobCtx, { publicationId })).toEqual({
        status: "NOOP",
        publicationStatus: "CANCELLED",
      });
      const sched = await queued({
        account: false,
        over: { status: "SCHEDULED", mode: "SCHEDULED" },
      });
      expect(await runPublication(jobCtx, { publicationId: sched.publicationId })).toEqual({
        status: "NOOP",
        publicationStatus: "SCHEDULED",
      });
      noCalls();
    });

    it("never repeats a post: the approved version is the only source of the text", async () => {
      const { publicationId, variantId } = await queued();
      mock.addAccount({ id: ES_ACCOUNT, username: "kitchen_es" });
      // The live draft changes after approval: the post still carries the approved caption.
      await t.db
        .update(schema.contentVariants)
        .set({ caption: "A different, unapproved caption." })
        .where(eq(schema.contentVariants.id, variantId));
      await runPublication(jobCtx, { publicationId });
      expect(mock.calls.find((c) => c.body.media_type === "CAROUSEL")?.body.caption).toBe(
        "Un pie de foto.\n\n#cocina",
      );
    });
  });
});
