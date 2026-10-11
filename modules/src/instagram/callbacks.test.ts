import { createHmac } from "node:crypto";
import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getDeletionStatus,
  handleDataDeletion,
  handleDeauthorize,
  InvalidSignedRequestError,
} from "./callbacks";
import { connectTestAccount, instagramFixture, newMock, TEST_APP_SECRET } from "./test-support";

// Deauthorize and data-deletion callbacks (M5-05, V-13): signed fixtures, valid and not.

/** A `signed_request` the way Meta builds it. */
function sign(payload: Record<string, unknown>, secret = TEST_APP_SECRET): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${signature}.${encoded}`;
}
const valid = (userId: string): string =>
  sign({ algorithm: "HMAC-SHA256", user_id: userId, issued_at: 1_790_000_000, expires: 0 });

describe("Meta callbacks", () => {
  let t: TestDb;
  let fx: Awaited<ReturnType<typeof instagramFixture>>;
  let mock: ReturnType<typeof newMock>;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    mock = newMock();
    fx = await instagramFixture(t.db, mock);
  });
  afterEach(async () => {
    await t.close();
  });

  const es = () => fx.marketIds["es-ES"] as string;
  const row = async (id: string) =>
    (
      await t.db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, id))
    )[0] as typeof schema.socialAccounts.$inferSelect;
  const audits = async () =>
    (await t.db.select({ action: schema.auditEvents.action }).from(schema.auditEvents)).map(
      (a) => a.action,
    );
  const system = () => ({ ...fx.ctx, actor: { type: "SYSTEM" as const } });

  it("revokes the account of the app-scoped user and destroys its token", async () => {
    const { account } = await connectTestAccount(fx.ctx, mock, {
      marketId: es(),
      accountId: "1784",
      over: { appScopedUserId: "scoped-9" },
    });
    expect(await handleDeauthorize(system(), { signedRequest: valid("scoped-9") })).toEqual({
      revoked: 1,
    });
    expect(await row(account.id)).toMatchObject({
      status: "REVOKED",
      tokenStatus: "REVOKED",
      accessTokenEncrypted: "revoked",
      tokenExpiresAt: null,
    });
    expect(await audits()).toContain("instagram.deauthorized");
    const [event] = await t.db.select().from(schema.integrationEvents);
    expect(event).toMatchObject({
      code: "DEAUTHORIZED",
      severity: "ERROR",
      socialAccountId: account.id,
    });
  });

  it("matches by the professional account id too, and is idempotent", async () => {
    const { account } = await connectTestAccount(fx.ctx, mock, {
      marketId: es(),
      accountId: "1784",
    });
    expect(await handleDeauthorize(system(), { signedRequest: valid("1784") })).toEqual({
      revoked: 1,
    });
    expect(await handleDeauthorize(system(), { signedRequest: valid("1784") })).toEqual({
      revoked: 0,
    });
    expect((await row(account.id)).status).toBe("REVOKED");
    expect(await t.db.select().from(schema.integrationEvents)).toHaveLength(1);
  });

  it("accepts a request for an unknown user and records that nothing matched", async () => {
    expect(await handleDeauthorize(system(), { signedRequest: valid("nobody") })).toEqual({
      revoked: 0,
    });
    expect(await audits()).toContain("instagram.deauthorize_unmatched");
  });

  const refused: [string, () => string, string][] = [
    [
      "a wrong signature",
      () => sign({ algorithm: "HMAC-SHA256", user_id: "1784" }, "another-secret"),
      "bad_signature",
    ],
    [
      "another algorithm",
      () => sign({ algorithm: "HMAC-SHA1", user_id: "1784" }),
      "unsupported_algorithm",
    ],
    ["no user", () => sign({ algorithm: "HMAC-SHA256" }), "no_user"],
    ["garbage", () => "not-a-signed-request", "malformed"],
    ["an empty value", () => "", "malformed"],
    [
      "a tampered payload",
      () =>
        `${valid("1784").split(".")[0]}.${Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "9999" })).toString("base64url")}`,
      "bad_signature",
    ],
  ];

  it.each(refused)("refuses %s and changes nothing", async (_name, make, reason) => {
    const { account } = await connectTestAccount(fx.ctx, mock, {
      marketId: es(),
      accountId: "1784",
    });
    for (const call of [handleDeauthorize, handleDataDeletion]) {
      const failure = await call(system(), { signedRequest: make() }).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(InvalidSignedRequestError);
      expect((failure as InvalidSignedRequestError).reason).toBe(reason);
    }
    expect((await row(account.id)).status).toBe("ACTIVE");
    expect(await audits()).not.toContain("instagram.deauthorized");
  });

  it("deletes the token and profile data on a data-deletion request and returns a code and a status URL", async () => {
    const { account } = await connectTestAccount(fx.ctx, mock, {
      marketId: es(),
      accountId: "1784",
      username: "kitchen_es",
      over: {
        appScopedUserId: "scoped-9",
        lastHealth: { ok: true, quotaUsage: 1, quotaTotal: 100 },
      },
    });
    const answer = await handleDataDeletion(system(), { signedRequest: valid("scoped-9") });
    expect(answer.confirmation_code).toMatch(/^[A-Z2-9]{12}$/);
    expect(answer.url).toBe(
      `https://app.example.test/data-deletion?code=${answer.confirmation_code}`,
    );
    const after = await row(account.id);
    expect(after).toMatchObject({
      status: "REVOKED",
      tokenStatus: "REVOKED",
      accessTokenEncrypted: "revoked",
      username: `deleted-${account.id.slice(0, 8)}`,
      instagramAccountId: `deleted:${account.id}`,
      appScopedUserId: null,
      accountType: null,
      scopes: [],
      lastHealth: null,
    });
    // The Instagram account can be connected again as a new row.
    mock.addAccount({ id: "1784", username: "kitchen_es" });
    const again = await connectTestAccount(fx.ctx, mock, { marketId: es(), accountId: "1784" });
    expect(again.account.id).not.toBe(account.id);
    // The trail names the code, not the person.
    const trail = JSON.stringify(await t.db.select().from(schema.auditEvents));
    expect(trail).toContain(answer.confirmation_code);
    expect(trail).not.toContain("kitchen_es");
  });

  it("gives each request its own code and a status page answer", async () => {
    await connectTestAccount(fx.ctx, mock, {
      marketId: es(),
      accountId: "1784",
      over: { appScopedUserId: "scoped-9" },
    });
    const first = await handleDataDeletion(system(), { signedRequest: valid("scoped-9") });
    const second = await handleDataDeletion(system(), { signedRequest: valid("scoped-9") });
    expect(second.confirmation_code).not.toBe(first.confirmation_code);
    expect(await getDeletionStatus(system(), first.confirmation_code)).toMatchObject({
      status: "COMPLETED",
      accounts: 1,
    });
    expect(await getDeletionStatus(system(), second.confirmation_code)).toMatchObject({
      status: "COMPLETED",
      accounts: 0,
    });
    expect(await getDeletionStatus(system(), "AAAAAAAAAAAA")).toBeNull();
    expect(await getDeletionStatus(system(), "'; drop table")).toBeNull();
    expect(await getDeletionStatus(system(), "")).toBeNull();
  });

  it("answers an unknown user's deletion request with a code too", async () => {
    const answer = await handleDataDeletion(system(), { signedRequest: valid("nobody") });
    expect(await getDeletionStatus(system(), answer.confirmation_code)).toMatchObject({
      accounts: 0,
    });
  });
});
