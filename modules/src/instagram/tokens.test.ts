import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { TransientError } from "@rc/lib/errors";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runJobHandler } from "../core";
import { checkAccountHealthJob, refreshInstagramTokensJob } from "../job-handlers";
import { decryptAccessToken } from "./accounts";
import { checkInstagramAccountHealth } from "./health";
import { connectTestAccount, instagramFixture, newMock } from "./test-support";
import { refreshDecision, refreshInstagramTokens } from "./tokens";

// Token refresh (J13) and account health (J14), M5-04.

const NOW = new Date("2026-10-10T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const inDays = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

describe("refreshDecision", () => {
  const acct = (refreshedDaysAgo: number, expiresInDays: number | null) => ({
    connectedAt: ago(100),
    tokenLastRefreshedAt: ago(refreshedDaysAgo),
    tokenExpiresAt: expiresInDays === null ? null : inDays(expiresInDays),
  });
  it.each([
    [0.5, 59, "TOO_RECENT"],
    [0.99, 5, "TOO_RECENT"],
    [1.01, 59, "NOT_DUE"],
    [3, 57, "NOT_DUE"],
    [3, 19, "REFRESH"],
    [3, 20.5, "NOT_DUE"],
    [7, 53, "REFRESH"],
    [6.9, 53, "NOT_DUE"],
    [30, null, "REFRESH"],
  ] as const)("refreshed %s days ago, expires in %s days → %s", (refreshed, expires, expected) => {
    expect(refreshDecision(acct(refreshed, expires), NOW)).toBe(expected);
  });
  it("uses the connection time when the token was never refreshed", () => {
    expect(
      refreshDecision(
        { connectedAt: ago(10), tokenLastRefreshedAt: null, tokenExpiresAt: inDays(50) },
        NOW,
      ),
    ).toBe("REFRESH");
  });
});

describe("token refresh and health jobs", () => {
  let t: TestDb;
  let fx: Awaited<ReturnType<typeof instagramFixture>>;
  let mock: ReturnType<typeof newMock>;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    mock = newMock({ now: () => fx.clock.now() });
    fx = await instagramFixture(t.db, mock);
  });
  afterEach(async () => {
    await t.close();
  });

  const es = () => fx.marketIds["es-ES"] as string;
  const en = () => fx.marketIds.en as string;
  const row = async (id: string) =>
    (
      await t.db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, id))
    )[0] as typeof schema.socialAccounts.$inferSelect;
  const events = () => t.db.select().from(schema.integrationEvents);

  /** An account whose token was issued `refreshedDaysAgo` ago and expires in `expiresInDays`. */
  const account = async (
    marketId: string,
    accountId: string,
    refreshedDaysAgo: number,
    expiresInDays: number,
  ) => {
    // The mock issues tokens at "now"; the stored dates say otherwise.
    return connectTestAccount(fx.ctx, mock, {
      marketId,
      accountId,
      tokenIssuedAt: ago(refreshedDaysAgo),
      over: { tokenLastRefreshedAt: ago(refreshedDaysAgo), tokenExpiresAt: inDays(expiresInDays) },
    });
  };

  it("refreshes a due token: new ciphertext, new expiry, VALID, audited; the old token stops working", async () => {
    fx.clock.advance(2 * 86_400_000);
    const { account: a, token: old } = await account(es(), "1784", 5, 15);
    const before = await row(a.id);
    const { results } = await refreshInstagramTokens(fx.ctx);
    expect(results).toEqual([{ socialAccountId: a.id, marketId: es(), outcome: "REFRESHED" }]);
    const after = await row(a.id);
    expect(after.accessTokenEncrypted).not.toBe(before.accessTokenEncrypted);
    const fresh = decryptAccessToken(fx.ctx, after);
    expect(fresh).not.toBe(old);
    expect(mock.tokens.has(fresh)).toBe(true);
    expect(mock.tokens.has(old)).toBe(false);
    expect(after.tokenExpiresAt?.toISOString()).toBe(
      new Date(fx.clock.now().getTime() + 5_183_944_000).toISOString(),
    );
    expect(after.tokenLastRefreshedAt?.toISOString()).toBe(fx.clock.now().toISOString());
    expect(after).toMatchObject({ tokenStatus: "VALID", status: "ACTIVE" });
    const audits = (
      await t.db.select({ action: schema.auditEvents.action }).from(schema.auditEvents)
    ).map((e) => e.action);
    expect(audits).toContain("instagram.token_refreshed");
  });

  it("does not refresh a token that is less than 24 hours old, nor one that is not due", async () => {
    const recent = await account(es(), "1784", 0.5, 5);
    const notDue = await account(en(), "1785", 3, 55);
    const { results } = await refreshInstagramTokens(fx.ctx);
    expect(results.map((r) => r.outcome).sort()).toEqual(["SKIPPED_NOT_DUE", "SKIPPED_TOO_RECENT"]);
    expect(mock.callsTo(/refresh_access_token/)).toHaveLength(0);
    expect((await row(recent.account.id)).accessTokenEncrypted).toBe(
      recent.account.accessTokenEncrypted,
    );
    expect((await row(notDue.account.id)).accessTokenEncrypted).toBe(
      notDue.account.accessTokenEncrypted,
    );
  });

  it("marks the account NEEDS_REAUTH when Instagram answers 190, and records an ERROR finding", async () => {
    const { account: a, token } = await account(es(), "1784", 5, 15);
    mock.revokeToken(token);
    const { results } = await refreshInstagramTokens(fx.ctx);
    expect(results[0]).toMatchObject({ outcome: "NEEDS_REAUTH", problem: "AUTH" });
    expect(await row(a.id)).toMatchObject({ status: "NEEDS_REAUTH", tokenStatus: "INVALID" });
    expect(await events()).toMatchObject([
      {
        integration: "instagram",
        severity: "ERROR",
        code: "TOKEN_INVALID",
        socialAccountId: a.id,
        resolvedAt: null,
      },
    ]);
    // A second run does nothing more and adds no second finding.
    await refreshInstagramTokens(fx.ctx);
    expect(await events()).toHaveLength(1);
  });

  it("flags an already expired token without calling Instagram", async () => {
    const { account: a } = await account(es(), "1784", 0.2, -1);
    const { results } = await refreshInstagramTokens(fx.ctx);
    expect(results[0]).toMatchObject({ outcome: "NEEDS_REAUTH" });
    expect((await row(a.id)).status).toBe("NEEDS_REAUTH");
    expect(mock.callsTo(/refresh_access_token/)).toHaveLength(0);
  });

  it("handles each account on its own and throws a retryable error after a transient failure", async () => {
    fx.clock.advance(86_400_000);
    const first = await account(es(), "1784", 5, 15);
    const second = await account(en(), "1785", 5, 15);
    mock.fail({ path: /refresh_access_token/, status: 503, error: { message: "down", code: 2 } });
    const failure = await refreshInstagramTokens(fx.ctx).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(TransientError);
    // One account was refreshed, the other has a finding and is untouched.
    const states = await Promise.all([row(first.account.id), row(second.account.id)]);
    expect(
      states.filter((s) => s.tokenLastRefreshedAt?.toISOString() === fx.clock.now().toISOString()),
    ).toHaveLength(1);
    expect((await events())[0]).toMatchObject({ code: "TOKEN_REFRESH_FAILED", severity: "WARN" });
    // The retry refreshes only what is still due, and settles the finding.
    const retry = await refreshInstagramTokens(fx.ctx);
    expect(retry.results.map((r) => r.outcome).sort()).toEqual(["REFRESHED", "SKIPPED_TOO_RECENT"]);
    expect((await events())[0]?.resolvedAt).toBeInstanceOf(Date);
  });

  it("calls a token EXPIRING when the refresh failed and less than 7 days are left", async () => {
    fx.clock.advance(86_400_000);
    const { account: a } = await account(es(), "1784", 5, 4);
    mock.fail({ path: /refresh_access_token/, status: 503, error: { message: "down", code: 2 } });
    await expect(refreshInstagramTokens(fx.ctx)).rejects.toBeInstanceOf(TransientError);
    expect(await row(a.id)).toMatchObject({ tokenStatus: "EXPIRING", status: "ACTIVE" });
    expect((await events())[0]).toMatchObject({ severity: "ERROR", code: "TOKEN_REFRESH_FAILED" });
  });

  it("leaves disconnected and NEEDS_REAUTH accounts alone, and can target one account", async () => {
    fx.clock.advance(86_400_000);
    const gone = await account(es(), "1784", 5, 15);
    await t.db
      .update(schema.socialAccounts)
      .set({ status: "DISABLED" })
      .where(eq(schema.socialAccounts.id, gone.account.id));
    const target = await account(en(), "1785", 5, 15);
    const { results } = await refreshInstagramTokens(fx.ctx, {
      socialAccountId: target.account.id,
    });
    expect(results.map((r) => r.socialAccountId)).toEqual([target.account.id]);
    expect((await refreshInstagramTokens(fx.ctx)).results).toHaveLength(1);
  });

  it("reads the profile and the publishing limit and stores the snapshot", async () => {
    mock.quotaUsage = 7;
    const { account: a } = await account(es(), "1784", 1, 50);
    const { results } = await checkInstagramAccountHealth(fx.ctx);
    expect(results).toEqual([
      { socialAccountId: a.id, marketId: es(), ok: true, quota: { used: 7, total: 100 } },
    ]);
    const saved = await row(a.id);
    expect(saved.lastHealth).toEqual({ ok: true, quotaUsage: 7, quotaTotal: 100 });
    expect(saved.lastHealthCheckAt?.toISOString()).toBe(fx.clock.now().toISOString());
    expect(mock.calls.map((c) => c.path)).toEqual(["/me", "/1784/content_publishing_limit"]);
    expect(mock.calls.every((c) => c.authorization?.startsWith("Bearer "))).toBe(true);
  });

  it("follows a changed user name", async () => {
    const { account: a } = await account(es(), "1784", 1, 50);
    mock.addAccount({ id: "1784", username: "renamed_es" });
    await checkInstagramAccountHealth(fx.ctx);
    expect((await row(a.id)).username).toBe("renamed_es");
  });

  it("makes the account NEEDS_REAUTH on 190", async () => {
    const { account: a, token } = await account(es(), "1784", 1, 50);
    mock.revokeToken(token);
    const { results } = await checkInstagramAccountHealth(fx.ctx);
    expect(results[0]).toMatchObject({ ok: false, needsReauth: true });
    expect(await row(a.id)).toMatchObject({
      status: "NEEDS_REAUTH",
      tokenStatus: "INVALID",
      lastHealth: { ok: false },
    });
    expect((await events())[0]).toMatchObject({ code: "TOKEN_INVALID", severity: "ERROR" });
    // NEEDS_REAUTH accounts are not checked again.
    expect((await checkInstagramAccountHealth(fx.ctx)).results).toEqual([]);
  });

  it("records a failed check as one open WARN finding and settles it when the check passes again", async () => {
    const { account: a } = await account(es(), "1784", 1, 50);
    mock.fail({ path: /^\/me$/, status: 500, error: { message: "boom", code: 2 }, times: 2 });
    for (let i = 0; i < 2; i++) {
      const { results } = await checkInstagramAccountHealth(fx.ctx);
      expect(results[0]).toMatchObject({ ok: false, problem: "TRANSIENT" });
    }
    expect((await row(a.id)).lastHealth).toMatchObject({ ok: false });
    expect(await events()).toHaveLength(1);
    expect((await row(a.id)).status).toBe("ACTIVE");
    await checkInstagramAccountHealth(fx.ctx);
    expect((await row(a.id)).lastHealth).toMatchObject({ ok: true });
    expect((await events())[0]?.resolvedAt).toBeInstanceOf(Date);
  });

  it("flags an account that stopped being professional", async () => {
    const { account: a } = await account(es(), "1784", 1, 50);
    mock.addAccount({ id: "1784", username: "acct_1784", accountType: "PERSONAL" });
    const { results } = await checkInstagramAccountHealth(fx.ctx);
    expect(results[0]).toMatchObject({ ok: false });
    expect((await events())[0]).toMatchObject({
      code: "NOT_PROFESSIONAL",
      severity: "ERROR",
      socialAccountId: a.id,
    });
  });

  it("runs as the J13 and J14 jobs, with the empty payload a cron run has", async () => {
    await account(es(), "1784", 1, 50);
    await expect(runJobHandler(checkAccountHealthJob, fx.ctx, {})).resolves.toMatchObject({
      results: [{ ok: true }],
    });
    await expect(runJobHandler(refreshInstagramTokensJob, fx.ctx, {})).resolves.toMatchObject({
      results: [{ outcome: "SKIPPED_NOT_DUE" }],
    });
    await expect(
      runJobHandler(refreshInstagramTokensJob, fx.ctx, { socialAccountId: "no" }),
    ).rejects.toThrow();
  });
});
