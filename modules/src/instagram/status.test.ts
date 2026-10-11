import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { ForbiddenError, InvalidStateError } from "@rc/lib/errors";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  accountHealth,
  disconnectInstagramAccount,
  getInstagramBanners,
  getInstagramOverview,
} from "./status";
import { connectTestAccount, instagramFixture, newMock } from "./test-support";

// Settings → Instagram data and banners (M5-03).

const NOW = new Date("2026-10-10T12:00:00Z");
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000);

describe("accountHealth", () => {
  const base = { status: "ACTIVE", tokenStatus: "VALID", tokenExpiresAt: inDays(40) } as const;
  it.each([
    [null, "NOT_CONNECTED"],
    [base, "OK"],
    [{ ...base, tokenExpiresAt: inDays(6.5) }, "EXPIRING"],
    [{ ...base, tokenExpiresAt: inDays(7.5) }, "OK"],
    [{ ...base, tokenStatus: "EXPIRING" }, "EXPIRING"],
    [{ ...base, status: "NEEDS_REAUTH" }, "NEEDS_REAUTH"],
    [{ ...base, tokenStatus: "INVALID" }, "NEEDS_REAUTH"],
    [{ ...base, tokenExpiresAt: inDays(-1) }, "NEEDS_REAUTH"],
    [{ ...base, status: "DISABLED" }, "DISCONNECTED"],
    [{ ...base, status: "REVOKED" }, "DISCONNECTED"],
    [{ ...base, tokenExpiresAt: null }, "OK"],
  ] as const)("%j is %s", (account, expected) => {
    expect(accountHealth(account, NOW)).toBe(expected);
  });
});

describe("Instagram overview, banners and disconnect", () => {
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
  const en = () => fx.marketIds.en as string;

  it("lists the active markets, connected or not, with the facts the screen shows", async () => {
    const { account } = await connectTestAccount(fx.ctx, mock, {
      marketId: es(),
      accountId: "1784",
      username: "kitchen_es",
      over: {
        lastHealth: { ok: true, quotaUsage: 3, quotaTotal: 100 },
        lastHealthCheckAt: NOW,
      },
    });
    const overview = await getInstagramOverview(fx.ctx);
    expect(overview).toMatchObject({ publishMode: "live", configured: true });
    const codes = overview.markets.map((m) => m.market.code);
    expect(codes).toContain("es-ES");
    expect(codes).not.toContain("fr-FR"); // inactive market
    const row = overview.markets.find((m) => m.market.code === "es-ES");
    expect(row).toMatchObject({
      health: "OK",
      daysLeft: 50,
      lastPublish: null,
      lastError: null,
      quota: { used: 3, total: 100 },
    });
    expect(row?.account).toMatchObject({
      id: account.id,
      username: "kitchen_es",
      status: "ACTIVE",
    });
    expect(JSON.stringify(row)).not.toContain("accessTokenEncrypted");
    expect(JSON.stringify(row)).not.toContain("enc:v1");
    expect(overview.markets.find((m) => m.market.code === "en")).toMatchObject({
      account: null,
      health: "NOT_CONNECTED",
    });
  });

  it("shows the last published post and the newest open finding", async () => {
    const { account } = await connectTestAccount(fx.ctx, mock, {
      marketId: es(),
      accountId: "1784",
    });
    await t.db.insert(schema.integrationEvents).values([
      {
        integration: "instagram",
        socialAccountId: account.id,
        severity: "ERROR",
        code: "190",
        message: "Token expired",
        occurredAt: new Date("2026-10-09T10:00:00Z"),
      },
      {
        integration: "instagram",
        socialAccountId: account.id,
        severity: "ERROR",
        code: "4",
        message: "Resolved one",
        resolvedAt: NOW,
      },
      {
        integration: "instagram",
        socialAccountId: account.id,
        severity: "INFO",
        code: "ok",
        message: "Info",
      },
    ]);
    const row = (await getInstagramOverview(fx.ctx)).markets.find((m) => m.market.code === "es-ES");
    expect(row?.lastError).toMatchObject({ code: "190", message: "Token expired" });
  });

  it("falls back to a failed health check for the last error", async () => {
    await connectTestAccount(fx.ctx, mock, {
      marketId: es(),
      accountId: "1784",
      over: {
        lastHealth: { ok: false, error: "Could not reach Instagram" },
        lastHealthCheckAt: NOW,
      },
    });
    const row = (await getInstagramOverview(fx.ctx)).markets.find((m) => m.market.code === "es-ES");
    expect(row?.lastError).toMatchObject({ code: "HEALTH", message: "Could not reach Instagram" });
  });

  it("raises banners for re-auth first, then for an expiring token, and none for healthy accounts", async () => {
    expect(await getInstagramBanners(fx.ctx)).toEqual([]);
    await connectTestAccount(fx.ctx, mock, {
      marketId: es(),
      accountId: "1784",
      over: { tokenExpiresAt: inDays(3) },
    });
    await connectTestAccount(fx.ctx, mock, {
      marketId: en(),
      accountId: "1785",
      over: { status: "NEEDS_REAUTH", tokenStatus: "INVALID" },
    });
    const banners = await getInstagramBanners(fx.ctx);
    expect(banners.map((b) => [b.marketCode, b.kind])).toEqual([
      ["en", "NEEDS_REAUTH"],
      ["es-ES", "EXPIRING"],
    ]);
    expect(banners[1]?.daysLeft).toBe(3);
  });

  it("reports the publish mode and whether the app is configured", async () => {
    const off = {
      ...fx.ctx,
      instagram: { ...fx.ctx.instagram, publishMode: "off" as const, app: undefined },
    };
    expect(await getInstagramOverview(off)).toMatchObject({
      publishMode: "off",
      configured: false,
    });
  });

  it("disconnects an account: token destroyed, DISABLED, audited, market free again", async () => {
    const { account } = await connectTestAccount(fx.ctx, mock, {
      marketId: es(),
      accountId: "1784",
    });
    await disconnectInstagramAccount(fx.ctx, { socialAccountId: account.id });
    const [row] = await t.db
      .select()
      .from(schema.socialAccounts)
      .where(eq(schema.socialAccounts.id, account.id));
    expect(row).toMatchObject({
      status: "DISABLED",
      tokenStatus: "REVOKED",
      accessTokenEncrypted: "revoked",
      tokenExpiresAt: null,
    });
    const audits = await t.db
      .select({ action: schema.auditEvents.action })
      .from(schema.auditEvents);
    expect(audits.map((a) => a.action)).toContain("instagram.disconnected");
    expect(
      (await getInstagramOverview(fx.ctx)).markets.find((m) => m.market.code === "es-ES")?.health,
    ).toBe("DISCONNECTED");
    await expect(
      disconnectInstagramAccount(fx.ctx, { socialAccountId: account.id }),
    ).rejects.toBeInstanceOf(InvalidStateError);
  });

  it("is for owners, and not while a post is going out", async () => {
    const { account } = await connectTestAccount(fx.ctx, mock, {
      marketId: es(),
      accountId: "1784",
    });
    await expect(
      disconnectInstagramAccount(fx.as("editor"), { socialAccountId: account.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // A publication in progress for this account (the rows it needs are inserted directly).
    const [brand] = await t.db.select().from(schema.brands);
    const [idea] = await t.db
      .insert(schema.masterIdeas)
      .values({
        brandId: brand?.id ?? "",
        topic: "T",
        category: "GRAINS_RICE_PASTA",
        angle: "COMMON_MISTAKE",
        coreMessage: "m",
        origin: "MANUAL",
      })
      .returning();
    const [variant] = await t.db
      .insert(schema.contentVariants)
      .values({ masterIdeaId: idea?.id ?? "", marketId: es() })
      .returning();
    const [render] = await t.db
      .insert(schema.carouselRenders)
      .values({ contentVariantId: variant?.id ?? "", inputHash: "h", templatesVersion: "t" })
      .returning();
    const [version] = await t.db
      .insert(schema.contentVariantVersions)
      .values({
        contentVariantId: variant?.id ?? "",
        versionNo: 1,
        carouselRenderId: render?.id ?? "",
        contentHash: "x",
        approvedBy: fx.userId,
        snapshot: {
          hook: "h",
          hookType: "Q",
          caption: "c",
          cta: { type: "SAVE", text: "s" },
          hashtags: [],
          slides: [],
          visualStyle: "W",
          templateSequence: [],
          renderId: render?.id ?? "",
          renderedSlideKeys: [],
          knowledge: [],
          generationVersion: "1",
        },
      })
      .returning();
    await t.db.insert(schema.publications).values({
      contentVariantId: variant?.id ?? "",
      contentVariantVersionId: version?.id ?? "",
      marketId: es(),
      socialAccountId: account.id,
      mode: "IMMEDIATE",
      status: "IN_PROGRESS",
      idempotencyKey: "pub:busy:0",
    });
    await expect(
      disconnectInstagramAccount(fx.ctx, { socialAccountId: account.id }),
    ).rejects.toBeInstanceOf(InvalidStateError);
  });
});
