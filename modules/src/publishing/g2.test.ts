import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ReviewFixture, reviewFixture } from "../content/variants/test-support";
import { audit } from "../core";
import { connectTestAccount, mockRuntime, newMock } from "../instagram/test-support";
import { checkG2Readiness, formatG2Readiness } from "./g2";

// What the software can say about Gate G2 (M5-11).

describe("G2 readiness", () => {
  let t: TestDb;
  let fx: ReviewFixture;
  const mock = newMock();

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    fx = await reviewFixture(t.db, {
      instagram: mockRuntime(mock, { allowlist: ["1784", "1785"] }),
    });
  });
  afterEach(async () => {
    await t.close();
  });

  const state = (r: Awaited<ReturnType<typeof checkG2Readiness>>, id: number) =>
    r.items.find((i) => i.id === id);

  it("starts with the manual items open and the automatic ones failing", async () => {
    const r = await checkG2Readiness(fx.ctx);
    expect(r.items.map((i) => [i.id, i.state])).toEqual([
      [1, "MANUAL"],
      [2, "FAIL"],
      [3, "FAIL"],
      [4, "MANUAL"],
      [5, "MANUAL"],
      [6, "FAIL"],
    ]);
    expect(r.automatedOk).toBe(false);
    expect(state(r, 2)?.details).toEqual(expect.arrayContaining(["Spain: no connected account"]));
    expect(formatG2Readiness(r)).toMatch(/FAIL\s+2\. Dry run passed/);
  });

  it("passes the automatic items when everything has happened", async () => {
    const markets = await t.db
      .select()
      .from(schema.markets)
      .where(eq(schema.markets.isActive, true));
    const ids: string[] = [];
    for (const [i, market] of markets.entries()) {
      const { account } = await connectTestAccount(fx.ctx, mock, {
        marketId: market.id,
        accountId: ["1784", "1785"][i] as string,
      });
      await audit(fx.ctx, {
        action: "instagram.token_refreshed",
        entityType: "social_account",
        entityId: account.id,
      });
      // A dry run and three published posts per market.
      const made = await fx.makeVariant({ status: "APPROVED", marketCode: market.code });
      const { versionId } = await fx.makeVersion(made.variantId);
      await fx.makePublication(made.variantId, versionId, {
        dryRun: true,
        status: "DRY_RUN_PASSED",
        mode: "IMMEDIATE",
        scheduledAt: null,
        socialAccountId: account.id,
      });
      for (let n = 0; n < 3; n += 1) {
        const v = await fx.makeVariant({ status: "PUBLISHED", marketCode: market.code });
        const ver = await fx.makeVersion(v.variantId);
        ids.push(
          await fx.makePublication(v.variantId, ver.versionId, {
            status: "PUBLISHED",
            instagramMediaId: `m-${market.code}-${n}`,
            permalink: `https://www.instagram.com/p/${market.code}${n}/`,
            socialAccountId: account.id,
          }),
        );
      }
    }
    await audit(fx.ctx, { action: "publishing.disabled", entityType: "app_setting" });
    await audit(fx.ctx, { action: "publishing.enabled", entityType: "app_setting" });
    const r = await checkG2Readiness(fx.ctx);
    expect(r.items.map((i) => [i.id, i.state])).toEqual([
      [1, "MANUAL"],
      [2, "PASS"],
      [3, "PASS"],
      [4, "MANUAL"],
      [5, "MANUAL"],
      [6, "PASS"],
    ]);
    expect(r.automatedOk).toBe(true);
    expect(ids).toHaveLength(markets.length * 3);
  });

  it("names what is wrong: an unlisted account, a foreign id in the allowlist, a stale token, too few posts", async () => {
    const [es] = await t.db.select().from(schema.markets).where(eq(schema.markets.code, "es-ES"));
    await connectTestAccount(fx.ctx, mock, {
      marketId: es?.id ?? "",
      accountId: "9999",
      username: "kitchen_es",
      over: { tokenLastRefreshedAt: new Date("2026-01-01T00:00:00Z") },
    });
    const r = await checkG2Readiness(fx.ctx);
    const three = state(r, 3)?.details.join("\n") ?? "";
    expect(three).toMatch(/not been switched off and on/);
    expect(three).toMatch(/@kitchen_es is connected but not in INSTAGRAM_ACCOUNT_ALLOWLIST/);
    expect(three).toMatch(/allowlist has 1784, which is not a connected account/);
    expect(three).toMatch(/token has not been refreshed since 2026-01-01/);
    expect(state(r, 6)?.details[0]).toMatch(/Spain: 0 of 3 published with a permalink/);
  });

  it("does not count a published post without a permalink", async () => {
    const [es] = await t.db.select().from(schema.markets).where(eq(schema.markets.code, "es-ES"));
    const v = await fx.makeVariant({ status: "PUBLISHED" });
    const ver = await fx.makeVersion(v.variantId);
    await fx.makePublication(v.variantId, ver.versionId, {
      status: "PUBLISHED",
      instagramMediaId: "m1",
      permalink: null,
    });
    const r = await checkG2Readiness(fx.ctx);
    expect(state(r, 6)?.details.find((d) => d.startsWith(es?.displayName ?? ""))).toMatch(
      /0 of 3 .*\(1 without one\)/,
    );
  });
});
