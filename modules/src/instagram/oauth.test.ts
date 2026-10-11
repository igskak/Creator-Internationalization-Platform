import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { ForbiddenError } from "@rc/lib/errors";
import { signToken } from "@rc/lib/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptAccessToken } from "./accounts";
import { completeInstagramOAuth, startInstagramOAuth } from "./oauth";
import { instagramFixture, newMock, TEST_STATE_SECRET } from "./test-support";

// The OAuth connect flow (M5-02): state, code exchange, profile checks, market binding, storage.

describe("Instagram OAuth", () => {
  let t: TestDb;
  let fx: Awaited<ReturnType<typeof instagramFixture>> & { marketId: string };
  let mock: ReturnType<typeof newMock>;
  let en: string;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    mock = newMock({
      accounts: [
        { id: "1784", username: "kitchen_es", accountType: "BUSINESS" },
        { id: "1785", username: "kitchen_en", accountType: "MEDIA_CREATOR" },
        { id: "1786", username: "just_a_person", accountType: "PERSONAL" },
      ],
    });
    const base = await instagramFixture(t.db, mock);
    fx = { ...base, marketId: base.marketIds["es-ES"] ?? "" };
    en = base.marketIds.en ?? "";
  });
  afterEach(async () => {
    await t.close();
  });

  const accounts = () => t.db.select().from(schema.socialAccounts);
  const audits = async () =>
    (await t.db.select({ action: schema.auditEvents.action }).from(schema.auditEvents)).map(
      (a) => a.action,
    );
  /** Start, "visit Instagram" for an account, and come back with its code. */
  const connect = async (accountId: string, marketId = fx.marketId) => {
    const { state, authorizeUrl } = await startInstagramOAuth(fx.ctx, { marketId });
    const code = mock.issueCode(accountId);
    return {
      state,
      authorizeUrl,
      code,
      run: (over = {}) =>
        completeInstagramOAuth(fx.ctx, { code, state, cookieState: state, ...over }),
    };
  };

  it("builds the authorize URL with the three scopes, the redirect and a signed state", async () => {
    const { authorizeUrl, state } = await startInstagramOAuth(fx.ctx, { marketId: fx.marketId });
    const url = new URL(authorizeUrl);
    expect(url.origin + url.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "1234567890",
      redirect_uri: "https://app.example.test/api/instagram/oauth/callback",
      response_type: "code",
      scope:
        "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights",
      state,
    });
    expect(await audits()).toContain("instagram.connect_started");
  });

  it("is for owners only", async () => {
    await expect(
      startInstagramOAuth(fx.as("editor"), { marketId: fx.marketId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const { state } = await startInstagramOAuth(fx.ctx, { marketId: fx.marketId });
    await expect(
      completeInstagramOAuth(fx.as("chef"), { code: "x", state, cookieState: state }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("connects an account: encrypted long-lived token, profile, scopes, expiry, audit", async () => {
    const flow = await connect("1784");
    const result = await flow.run();
    expect(result).toMatchObject({ ok: true, username: "kitchen_es", reconnected: false });
    const [account] = await accounts();
    expect(account).toMatchObject({
      marketId: fx.marketId,
      username: "kitchen_es",
      instagramAccountId: "1784",
      accountType: "BUSINESS",
      status: "ACTIVE",
      tokenStatus: "VALID",
      connectedBy: fx.userId,
    });
    expect(account?.scopes).toEqual([
      "instagram_business_basic",
      "instagram_business_content_publish",
    ]);
    expect(account?.tokenExpiresAt?.toISOString()).toBe(
      new Date(Date.parse("2026-10-10T12:00:00Z") + 5_183_944_000).toISOString(),
    );
    // Encrypted at rest: the plain token is only recoverable with the row id as AAD.
    expect(account?.accessTokenEncrypted).toMatch(/^enc:v1:/);
    const plain = decryptAccessToken(fx.ctx, account as NonNullable<typeof account>);
    expect(plain).toMatch(/^igl-1784-/);
    expect(account?.accessTokenEncrypted).not.toContain(plain);
    expect(() =>
      decryptAccessToken(fx.ctx, { ...(account as NonNullable<typeof account>), id: "other-row" }),
    ).toThrow();
    // The token works against the API, and is nowhere in the audit trail.
    expect(mock.tokens.has(plain)).toBe(true);
    const events = JSON.stringify(await t.db.select().from(schema.auditEvents));
    expect(events).toContain("instagram.connected");
    expect(events).not.toContain(plain);
    expect(events).not.toContain(flow.code);
  });

  it("accepts the code with Instagram's trailing #_", async () => {
    const flow = await connect("1785", en);
    expect(
      await completeInstagramOAuth(fx.ctx, {
        code: `${flow.code}#_`,
        state: flow.state,
        cookieState: flow.state,
      }),
    ).toMatchObject({ ok: true });
  });

  it("reconnects the same account in place and settles open findings", async () => {
    await (await connect("1784")).run();
    const [first] = await accounts();
    await t.db
      .update(schema.socialAccounts)
      .set({ status: "NEEDS_REAUTH", tokenStatus: "INVALID" })
      .where(eq(schema.socialAccounts.id, first?.id ?? ""));
    await t.db.insert(schema.integrationEvents).values({
      integration: "instagram",
      socialAccountId: first?.id ?? "",
      severity: "ERROR",
      code: "190",
      message: "Token expired",
    });
    const result = await (await connect("1784")).run();
    expect(result).toMatchObject({ ok: true, reconnected: true, socialAccountId: first?.id });
    const rows = await accounts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "ACTIVE", tokenStatus: "VALID" });
    expect(rows[0]?.accessTokenEncrypted).not.toBe(first?.accessTokenEncrypted);
    const [event] = await t.db.select().from(schema.integrationEvents);
    expect(event?.resolvedAt).toBeInstanceOf(Date);
  });

  it("refuses a tampered state", async () => {
    const flow = await connect("1784");
    const [payload, signature] = flow.state.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ data: { marketId: en, userId: fx.userId, nonce: "n" }, exp: 9999999999 }),
    ).toString("base64url");
    for (const state of [`${forgedPayload}.${signature}`, `${payload}.AAAA`, "garbage", ""]) {
      const result = await completeInstagramOAuth(fx.ctx, {
        code: flow.code,
        state,
        cookieState: state,
      });
      expect(result).toMatchObject({ ok: false, reason: "invalid_state" });
    }
    expect(await accounts()).toHaveLength(0);
    expect(await audits()).toContain("instagram.connect_failed");
  });

  it("refuses a state that expired", async () => {
    const flow = await connect("1784");
    fx.clock.advance(11 * 60_000);
    expect(await flow.run()).toMatchObject({ ok: false, reason: "expired_state" });
  });

  it("refuses when the cookie does not match the state, or the state is another user's", async () => {
    const flow = await connect("1784");
    const other = signToken(
      { marketId: fx.marketId, userId: fx.userId, nonce: "zzz" },
      { secret: TEST_STATE_SECRET, expiresAt: new Date("2026-10-10T13:00:00Z") },
    );
    expect(await flow.run({ cookieState: other })).toMatchObject({
      ok: false,
      reason: "state_mismatch",
    });
    expect(await flow.run({ cookieState: null })).toMatchObject({
      ok: false,
      reason: "invalid_state",
    });
    const foreign = signToken(
      { marketId: fx.marketId, userId: "someone-else", nonce: "n" },
      { secret: TEST_STATE_SECRET, expiresAt: new Date("2026-10-10T13:00:00Z") },
    );
    expect(
      await completeInstagramOAuth(fx.ctx, {
        code: flow.code,
        state: foreign,
        cookieState: foreign,
      }),
    ).toMatchObject({ ok: false, reason: "state_mismatch" });
  });

  it("reports a refused authorization (the owner pressed Cancel)", async () => {
    const flow = await connect("1784");
    expect(await flow.run({ code: null, denied: true })).toMatchObject({
      ok: false,
      reason: "denied",
    });
  });

  it("reports a code Instagram does not accept, without throwing", async () => {
    const flow = await connect("1784");
    expect(await flow.run({ code: "made-up" })).toMatchObject({
      ok: false,
      reason: "exchange_failed",
    });
    expect(await accounts()).toHaveLength(0);
  });

  it("refuses an account that is not professional", async () => {
    const flow = await connect("1786");
    expect(await flow.run()).toMatchObject({ ok: false, reason: "not_professional" });
    expect(await accounts()).toHaveLength(0);
  });

  it("refuses an account that is connected to another market", async () => {
    await (await connect("1784")).run();
    const flow = await connect("1784", en);
    expect(await flow.run()).toMatchObject({ ok: false, reason: "bound_to_other_market" });
    expect(await accounts()).toHaveLength(1);
  });

  it("refuses a second account for a market that has one", async () => {
    await (await connect("1784")).run();
    mock.addAccount({ id: "1790", username: "another", accountType: "BUSINESS" });
    const flow = await connect("1790");
    expect(await flow.run()).toMatchObject({ ok: false, reason: "market_has_other_account" });
  });

  it("lets a revoked account move to another market", async () => {
    await (await connect("1784")).run();
    await t.db.update(schema.socialAccounts).set({ status: "REVOKED" });
    expect(await (await connect("1784", en)).run()).toMatchObject({ ok: true, marketId: en });
    const [row] = await accounts();
    expect(row).toMatchObject({ marketId: en, status: "ACTIVE" });
  });

  it("answers a failure from Instagram's profile call with exchange_failed", async () => {
    const flow = await connect("1784");
    mock.fail({ path: /^\/me$/, status: 500, error: { message: "boom", code: 2 } });
    expect(await flow.run()).toMatchObject({ ok: false, reason: "exchange_failed" });
  });
});
