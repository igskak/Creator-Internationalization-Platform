import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ReviewFixture, reviewFixture } from "./content/variants/test-support";
import { checkLiveness, getSystemHealth } from "./health";
import {
  aiProvidersState,
  insightsState,
  instagramState,
  jobsState,
  probeState,
  publishingState,
  worst,
} from "./health/rules";
import { connectTestAccount, mockRuntime, newMock } from "./instagram/test-support";
import { setAppSetting } from "./settings";

// H-01: every indicator of plan 12 §12.9 turns amber or red on fixture conditions (a cross-module
// test: health reads instagram, publishing, analytics and ai). The fixture clock is
// 2026-10-10 12:00 UTC.

const NOW = new Date("2026-10-10T12:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("health rules", () => {
  const ig = (over: Partial<Parameters<typeof instagramState>[0]> = {}) =>
    instagramState({
      status: "ACTIVE",
      tokenStatus: "VALID",
      tokenExpiresAt: new Date(NOW.getTime() + 40 * DAY),
      quota: { used: 2, total: 100 },
      now: NOW,
      ...over,
    });

  it("grades an Instagram account", () => {
    expect(ig()).toEqual({ state: "GREEN", reason: "OK" });
    expect(ig({ tokenExpiresAt: new Date(NOW.getTime() + 14 * DAY) })).toEqual({
      state: "AMBER",
      reason: "EXPIRING",
    });
    expect(ig({ quota: { used: 81, total: 100 } })).toEqual({ state: "AMBER", reason: "QUOTA" });
    expect(ig({ status: "NEEDS_REAUTH" })).toEqual({ state: "RED", reason: "NEEDS_REAUTH" });
    expect(ig({ tokenExpiresAt: ago(MIN) })).toEqual({ state: "RED", reason: "NEEDS_REAUTH" });
    expect(ig({ status: "REVOKED" })).toEqual({ state: "RED", reason: "REVOKED" });
    expect(ig({ status: "DISABLED" })).toEqual({ state: "NONE", reason: "DISCONNECTED" });
    expect(ig({ status: null })).toEqual({ state: "NONE", reason: "NOT_CONNECTED" });
  });

  it("grades publishing, jobs, insights, AI providers and probes", () => {
    expect(publishingState({ enabled: true, failed7d: 0, waiting: 0 })).toBe("GREEN");
    expect(publishingState({ enabled: false, failed7d: 0, waiting: 0 })).toBe("AMBER");
    expect(publishingState({ enabled: true, failed7d: 0, waiting: 1 })).toBe("AMBER");
    expect(publishingState({ enabled: true, failed7d: 1, waiting: 0 })).toBe("RED");

    expect(jobsState({ failed24h: 0, stuck: 0 })).toBe("GREEN");
    expect(jobsState({ failed24h: 2, stuck: 0 })).toBe("AMBER");
    expect(jobsState({ failed24h: 3, stuck: 0 })).toBe("RED");
    expect(jobsState({ failed24h: 0, stuck: 1 })).toBe("RED");

    expect(insightsState(null)).toBe("GREEN");
    expect(insightsState(2.9)).toBe("GREEN");
    expect(insightsState(3)).toBe("AMBER");
    expect(insightsState(24)).toBe("AMBER");
    expect(insightsState(24.1)).toBe("RED");

    expect(aiProvidersState({ runs: 0, failed: 0, refused: 0, invalid: 0 })).toBe("GREEN");
    expect(aiProvidersState({ runs: 100, failed: 0, refused: 3, invalid: 2 })).toBe("GREEN");
    expect(aiProvidersState({ runs: 100, failed: 0, refused: 3, invalid: 3 })).toBe("AMBER");
    expect(aiProvidersState({ runs: 10, failed: 3, refused: 0, invalid: 0 })).toBe("RED");

    expect(probeState({ ok: true, ms: 40, configured: true })).toBe("GREEN");
    expect(probeState({ ok: true, ms: 2_500, configured: true })).toBe("AMBER");
    expect(probeState({ ok: false, ms: 5_000, configured: true })).toBe("RED");
    expect(probeState({ ok: false, ms: null, configured: false })).toBe("NONE");

    expect(worst([])).toBe("NONE");
    expect(worst(["NONE", "GREEN"])).toBe("GREEN");
    expect(worst(["GREEN", "RED", "AMBER"])).toBe("RED");
  });
});

describe("getSystemHealth", () => {
  let t: TestDb;
  let fx: ReviewFixture;
  let mock: ReturnType<typeof newMock>;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    mock = newMock({ accounts: [], now: () => fx.clock.now() });
    fx = await reviewFixture(t.db, { instagram: mockRuntime(mock, { allowlist: ["1784"] }) });
    await setAppSetting(fx.ctx, { key: "publishing.enabled", value: true });
  });
  afterEach(async () => {
    await t.close();
  });

  async function marketId(code: string) {
    const [m] = await t.db.select().from(schema.markets).where(eq(schema.markets.code, code));
    return m?.id ?? "";
  }

  const connect = async (over: Partial<typeof schema.socialAccounts.$inferInsert> = {}) =>
    (
      await connectTestAccount(fx.ctx, mock, {
        marketId: await marketId("es-ES"),
        accountId: "1784",
        username: "kitchen_es",
        over: { connectedAt: ago(30 * DAY), ...over },
      })
    ).account;

  async function publication(over: Partial<typeof schema.publications.$inferInsert>) {
    const { variantId } = await fx.makeVariant({ status: "APPROVED" });
    const { versionId } = await fx.makeVersion(variantId);
    return fx.makePublication(variantId, versionId, { mode: "IMMEDIATE", ...over });
  }

  it("is green on a quiet system and says why the rest is not applicable", async () => {
    await connect();
    const h = await getSystemHealth(fx.ctx);
    expect(h.connectivity.state).toBe("GREEN");
    expect(h.instagram.accounts.find((a) => a.marketCode === "es-ES")).toMatchObject({
      state: "GREEN",
      reason: "OK",
      username: "kitchen_es",
    });
    expect(h.instagram.accounts.find((a) => a.marketCode === "en")).toMatchObject({
      state: "NONE",
      reason: "NOT_CONNECTED",
    });
    expect(h.instagram.state).toBe("GREEN");
    expect(h.publishing).toMatchObject({ state: "GREEN", enabled: true, failed7d: 0, waiting: 0 });
    expect(h.jobs.state).toBe("GREEN");
    expect(h.jobs.stuck).toEqual([]);
    expect(h.aiCost.state).toBe("NONE");
    // The account was connected 30 days ago and has no metrics row for 9 Oct: J12 owes it.
    expect(h.insights.late).toEqual([
      expect.objectContaining({ kind: "ACCOUNT", label: "2026-10-09" }),
    ]);
  });

  it("turns Instagram amber for an expiring token and red for one that needs re-auth", async () => {
    const account = await connect({ tokenExpiresAt: new Date(NOW.getTime() + 10 * DAY) });
    expect((await getSystemHealth(fx.ctx)).instagram.accounts[0]).toMatchObject({
      state: "AMBER",
      reason: "EXPIRING",
      daysLeft: 10,
    });
    await t.db
      .update(schema.socialAccounts)
      .set({ status: "NEEDS_REAUTH" })
      .where(eq(schema.socialAccounts.id, account.id));
    const h = await getSystemHealth(fx.ctx);
    expect(h.instagram.state).toBe("RED");
    expect(h.overall).toBe("RED");
  });

  it("turns publishing amber when switched off or a post waits, red on a failure", async () => {
    await setAppSetting(fx.ctx, { key: "publishing.enabled", value: false });
    expect((await getSystemHealth(fx.ctx)).publishing.state).toBe("AMBER");
    await setAppSetting(fx.ctx, { key: "publishing.enabled", value: true });

    await publication({ status: "QUEUED", updatedAt: ago(20 * MIN) });
    expect((await getSystemHealth(fx.ctx)).publishing).toMatchObject({
      state: "AMBER",
      waiting: 1,
    });

    await publication({
      status: "FAILED",
      updatedAt: ago(2 * DAY),
      lastError: {
        code: "9007",
        message: "Media not ready.",
        classification: "PERMANENT",
      } as never,
    });
    const h = await getSystemHealth(fx.ctx);
    expect(h.publishing).toMatchObject({ state: "RED", failed7d: 1 });
    expect(h.publishing.lastFailure).toMatchObject({ message: "Media not ready." });
    expect(h.publishing.lastFailure?.ideaId).toEqual(expect.any(String));
    // Two days ago is outside the 24 hours of the job indicator.
    expect(h.jobs.failed24h.PUBLISHING).toBe(0);
  });

  it("counts failures by domain and flags stuck items", async () => {
    await publication({ status: "FAILED", updatedAt: ago(HOUR), dryRun: true });
    const failed = await fx.makeVariant({ status: "FAILED", marketCode: "en" });
    expect(failed.variantId).toBeTruthy();
    let h = await getSystemHealth(fx.ctx);
    expect(h.jobs.failed24h).toMatchObject({ PUBLISHING: 1, GENERATION: 1 });
    expect(h.jobs.state).toBe("AMBER");
    // A dry run that failed is not a live failure.
    expect(h.publishing.failed7d).toBe(0);

    const generating = await fx.makeVariant({ status: "GENERATING", updatedAt: ago(40 * MIN) });
    await fx.makeVariant({ status: "GENERATING", updatedAt: ago(10 * MIN), marketCode: "en" });
    const [brand] = await t.db.select().from(schema.brands);
    const [source] = await t.db
      .insert(schema.sourceAssets)
      .values({
        brandId: brand?.id ?? "",
        type: "GUIDE",
        title: "Synthetic guide",
        originalLanguage: "ru",
        rights: {} as never,
        processingStatus: "PROCESSING",
        updatedAt: ago(3 * HOUR),
      })
      .returning();
    h = await getSystemHealth(fx.ctx);
    expect(h.jobs.stuck.map((s) => [s.kind, s.id])).toEqual([
      ["SOURCE_PROCESSING", source?.id],
      ["VARIANT_GENERATING", generating.variantId],
    ]);
    expect(h.jobs.stuck[1]).toMatchObject({ ideaId: expect.any(String), marketCode: "es-ES" });
    expect(h.jobs.state).toBe("RED");
  });

  it("measures how late the oldest due snapshot is", async () => {
    const account = await connect();
    await t.db.insert(schema.accountMetricSnapshots).values({
      socialAccountId: account.id,
      metricDate: "2026-10-09",
      measuredAt: ago(9 * HOUR),
      raw: {},
      apiVersion: "v24.0",
    });
    const id = await publication({
      status: "PUBLISHED",
      publishedAt: ago(30 * HOUR),
      instagramMediaId: "m-1",
      socialAccountId: account.id,
    });
    // D1 was due 6 hours ago (H2 is covered by the later slot).
    let h = await getSystemHealth(fx.ctx);
    expect(h.insights).toMatchObject({ state: "AMBER", due: 1, oldestLagHours: 6 });
    expect(h.insights.late[0]).toMatchObject({ kind: "POST", id, label: "D1" });

    await t.db.insert(schema.metricSnapshots).values({
      publicationId: id,
      snapshotSlot: "D1",
      measuredAt: ago(5 * HOUR),
      mediaAgeHours: "25.00",
      rawMetricsJson: {},
      apiVersion: "v24.0",
    });
    h = await getSystemHealth(fx.ctx);
    expect(h.insights).toMatchObject({ state: "GREEN", due: 0, oldestLagHours: null });

    fx.clock.set(new Date(NOW.getTime() + 2 * DAY)); // 12 Oct 12:00: D3 due 6 h ago, 10 and 11 Oct missing
    h = await getSystemHealth(fx.ctx);
    expect(h.insights.late.map((l) => [l.kind, l.label])).toEqual([
      ["ACCOUNT", "2026-10-11"],
      ["POST", "D3"],
    ]);
    expect(h.insights.state).toBe("AMBER");
    fx.clock.set(new Date(NOW.getTime() + 3 * DAY));
    expect((await getSystemHealth(fx.ctx)).insights.state).toBe("RED");
  });

  it("grades AI providers on the last 24 hours and the cost on the budget", async () => {
    const run = (status: (typeof schema.generationRuns.$inferInsert)["status"], cost = "1.0000") =>
      t.db.insert(schema.generationRuns).values({
        stage: "CONTENT_WRITING",
        promptId: "p",
        promptVersion: 1,
        promptHash: "h",
        provider: "fake",
        model: "fake",
        params: {},
        inputHash: `i-${Math.random()}`,
        status,
        costUsd: cost,
        createdAt: ago(HOUR),
      });
    for (let i = 0; i < 7; i++) await run("SUCCEEDED");
    await run("REFUSED");
    let h = await getSystemHealth(fx.ctx);
    expect(h.aiProviders).toMatchObject({ state: "AMBER", runs: 8, refused: 1 });
    await run("FAILED");
    await run("FAILED");
    await run("FAILED");
    h = await getSystemHealth(fx.ctx);
    expect(h.aiProviders).toMatchObject({ state: "RED", failed: 3 });

    await setAppSetting(fx.ctx, { key: "ai.monthly_budget_usd", value: 10 });
    h = await getSystemHealth(fx.ctx);
    expect(h.aiCost).toMatchObject({ state: "RED", monthToDateUsd: 11, budgetUsd: 10 });
  });

  it("shows open findings and the newest audit events", async () => {
    await t.db.insert(schema.integrationEvents).values([
      {
        integration: "instagram",
        severity: "WARN",
        code: "HEALTH_CHECK_FAILED",
        message: "Failed.",
      },
      { integration: "instagram", severity: "INFO", code: "NOTE", message: "Info only." },
      {
        integration: "instagram",
        severity: "ERROR",
        code: "OLD",
        message: "Resolved.",
        resolvedAt: ago(HOUR),
      },
    ]);
    const h = await getSystemHealth(fx.ctx);
    expect(h.problems.map((p) => p.code)).toEqual(["HEALTH_CHECK_FAILED"]);
    expect(h.activity[0]).toMatchObject({ action: "settings.changed" });
  });
});

describe("checkLiveness", () => {
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

  it("is ok with both probes answering, degraded when storage fails, never with an error text", async () => {
    expect(await checkLiveness(fx.ctx, "abcdef1234567890")).toEqual({
      status: "ok",
      version: "abcdef123456",
      checks: { db: "GREEN", storage: "GREEN" },
    });
    const broken = {
      ...fx.ctx,
      storage: {
        ...fx.ctx.storage,
        head: () => Promise.reject(new Error("secret-bearing message")),
      },
    };
    const live = await checkLiveness(broken, undefined);
    expect(live).toEqual({
      status: "degraded",
      version: null,
      checks: { db: "GREEN", storage: "RED" },
    });
    expect(JSON.stringify(live)).not.toContain("secret");
  });
});
