import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { ForbiddenError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createServiceContext,
  isEmailAllowed,
  requireRole,
  resolveAppUser,
  type ServiceContext,
} from "./index";

const logger = createLogger({
  service: "web",
  env: "test",
  level: "fatal",
  destination: { write: () => {} },
});
const AUTH_A = "11111111-1111-4111-8111-111111111111";
const AUTH_B = "22222222-2222-4222-8222-222222222222";

describe("allowlist", () => {
  let t: TestDb;
  let ctx: ServiceContext;

  beforeEach(async () => {
    t = await createTestDb();
    ctx = createServiceContext({ db: t.db, logger, actor: { type: "SYSTEM" } });
    await t.db.insert(schema.appUsers).values([
      { email: "owner@example.com", role: "owner" },
      { email: "chef@example.com", role: "chef" },
      { email: "former@example.com", role: "editor", isActive: false },
    ]);
  });

  afterEach(async () => {
    await t.close();
  });

  it("links auth_user_id on first login (case-insensitive email) and audits it", async () => {
    const result = await resolveAppUser(ctx, { authUserId: AUTH_A, email: "Owner@Example.com" });
    expect(result).toMatchObject({
      ok: true,
      linked: true,
      user: { email: "owner@example.com", role: "owner" },
    });
    const [row] = await t.db
      .select()
      .from(schema.appUsers)
      .where(eq(schema.appUsers.email, "owner@example.com"));
    expect(row?.authUserId).toBe(AUTH_A);
    const events = await t.db.select().from(schema.auditEvents);
    expect(events).toEqual([
      expect.objectContaining({ action: "user.linked", actorType: "USER", entityId: row?.id }),
    ]);
  });

  it("finds a linked user by auth id on later logins, even if the email changed", async () => {
    await resolveAppUser(ctx, { authUserId: AUTH_A, email: "owner@example.com" });
    const again = await resolveAppUser(ctx, { authUserId: AUTH_A, email: "renamed@example.com" });
    expect(again).toMatchObject({ ok: true, linked: false, user: { email: "owner@example.com" } });
  });

  it("refuses unknown emails", async () => {
    expect(
      await resolveAppUser(ctx, { authUserId: AUTH_A, email: "stranger@example.com" }),
    ).toEqual({
      ok: false,
      reason: "unknown",
    });
  });

  it("refuses inactive users, before and after linking", async () => {
    expect(await resolveAppUser(ctx, { authUserId: AUTH_A, email: "former@example.com" })).toEqual({
      ok: false,
      reason: "inactive",
    });
    await resolveAppUser(ctx, { authUserId: AUTH_B, email: "chef@example.com" });
    await t.db
      .update(schema.appUsers)
      .set({ isActive: false })
      .where(eq(schema.appUsers.email, "chef@example.com"));
    expect(await resolveAppUser(ctx, { authUserId: AUTH_B, email: "chef@example.com" })).toEqual({
      ok: false,
      reason: "inactive",
    });
  });

  it("refuses an email already linked to another Supabase account", async () => {
    await resolveAppUser(ctx, { authUserId: AUTH_A, email: "owner@example.com" });
    expect(await resolveAppUser(ctx, { authUserId: AUTH_B, email: "owner@example.com" })).toEqual({
      ok: false,
      reason: "email_linked_to_other_account",
    });
  });

  it("allows magic links only for active allowlisted emails", async () => {
    expect(await isEmailAllowed(ctx, " CHEF@example.com ")).toBe(true);
    expect(await isEmailAllowed(ctx, "former@example.com")).toBe(false);
    expect(await isEmailAllowed(ctx, "stranger@example.com")).toBe(false);
  });
});

describe("requireRole", () => {
  const chef = { id: "u1", email: "chef@example.com", displayName: null, role: "chef" as const };

  it("passes for an allowed role and throws ForbiddenError otherwise", () => {
    expect(requireRole(chef, ["owner", "chef"])).toBe(chef);
    expect(() => requireRole(chef, ["owner"])).toThrow(ForbiddenError);
  });
});
