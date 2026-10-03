import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { createLogger } from "@rc/lib/logging";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, type ServiceContext } from "../../core";
import { getAllRightsDefaults, getRightsDefault } from "./defaults";

const logger = createLogger({
  service: "web",
  env: "test",
  level: "fatal",
  destination: { write: () => {} },
});

describe("rights defaults", () => {
  let t: TestDb;
  let ctx: ServiceContext;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    ctx = createServiceContext({ db: t.db, logger, actor: { type: "SYSTEM" } });
  });
  afterEach(async () => {
    await t.close();
  });

  it("returns the seeded policy: everything UNKNOWN, so AI is blocked", async () => {
    const policy = await getRightsDefault(ctx, "BOOK");
    expect(policy.aiProcessing).toBe("UNKNOWN");
    expect(Object.keys(await getAllRightsDefaults(ctx))).toHaveLength(9);
  });

  it("reflects the owner's settings per type and strips confirmation fields", async () => {
    const all = await getAllRightsDefaults(ctx);
    await t.db
      .update(schema.appSettings)
      .set({
        value: {
          ...all,
          GUIDE: {
            ...all.GUIDE,
            aiProcessing: "ALLOWED",
            confirmedBy: "11111111-1111-4111-8111-111111111111",
            confirmedAt: "2026-10-01T10:00:00+00:00",
          },
        },
      })
      .where(eq(schema.appSettings.key, "rights.defaults"));
    const guide = await getRightsDefault(ctx, "GUIDE");
    expect(guide.aiProcessing).toBe("ALLOWED");
    expect(guide).not.toHaveProperty("confirmedBy");
    expect(guide).not.toHaveProperty("confirmedAt");
    expect((await getRightsDefault(ctx, "BOOK")).aiProcessing).toBe("UNKNOWN");
  });

  it("falls back to all-UNKNOWN when the setting is missing or malformed", async () => {
    await t.db.delete(schema.appSettings).where(eq(schema.appSettings.key, "rights.defaults"));
    expect((await getRightsDefault(ctx, "NOTE")).aiProcessing).toBe("UNKNOWN");
    await t.db
      .insert(schema.appSettings)
      .values({ key: "rights.defaults", value: { BOOK: "bad" } });
    expect(await getRightsDefault(ctx, "NOTE")).toMatchObject({
      aiProcessing: "UNKNOWN",
      use: "UNKNOWN",
    });
  });
});
