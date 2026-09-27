import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { createLogger } from "@rc/lib/logging";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServiceContext, type ServiceContext } from "../core";
import { getMarketByCode, listMarkets } from "./index";

const logger = createLogger({
  service: "web",
  env: "test",
  level: "fatal",
  destination: { write: () => {} },
});

describe("markets", () => {
  let t: TestDb;
  let ctx: ServiceContext;

  beforeAll(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: [] });
    ctx = createServiceContext({ db: t.db, logger, actor: { type: "SYSTEM" } });
  });

  afterAll(async () => {
    await t.close();
  });

  it("lists markets in sidebar order with the inactive one last", async () => {
    const markets = await listMarkets(ctx);
    expect(markets.map((m) => [m.code, m.isActive])).toEqual([
      ["es-ES", true],
      ["en", true],
      ["fr-FR", false],
    ]);
  });

  it("finds a market by code", async () => {
    expect(await getMarketByCode(ctx, "es-ES")).toMatchObject({
      displayName: "Spain",
      flagEmoji: "🇪🇸",
    });
    expect(await getMarketByCode(ctx, "de-DE")).toBeNull();
  });
});
