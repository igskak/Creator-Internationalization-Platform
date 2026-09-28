import { schema } from "@rc/db";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { ForbiddenError, ValidationError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, type ServiceContext } from "../core";
import { getMarketProfile, updateMarket } from "./index";

const logger = createLogger({
  service: "web",
  env: "test",
  level: "fatal",
  destination: { write: () => {} },
});

describe("updateMarket", () => {
  let t: TestDb;
  let owner: ServiceContext;
  let editor: ServiceContext;
  let marketId: string;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    const [user] = await t.db.select().from(schema.appUsers);
    owner = createServiceContext({
      db: t.db,
      logger,
      actor: { type: "USER", userId: user?.id ?? "", role: "owner" },
    });
    editor = createServiceContext({
      db: t.db,
      logger,
      actor: { type: "USER", userId: user?.id ?? "", role: "editor" },
    });
    marketId = (await getMarketProfile(owner, "es-ES"))?.id ?? "";
  });

  afterEach(async () => {
    await t.close();
  });

  const auditRows = () => t.db.select().from(schema.auditEvents);

  it("persists profile fields and audits only the fields that changed", async () => {
    const market = await updateMarket(editor, {
      marketId,
      toneNotes: "Cercano, tuteo.",
      preferredVocabulary: [{ concept: "shrimp", preferred: "gamba", avoid: ["camarón"] }],
      forbiddenPatterns: [{ pattern: "\\bcamar[oó]n\\b", kind: "REGEX", reason: "LatAm term" }],
      timezone: "Europe/Madrid",
    });
    expect(market.toneNotes).toBe("Cercano, tuteo.");
    expect(market.forbiddenPatterns).toHaveLength(1);
    expect(await auditRows()).toEqual([
      expect.objectContaining({
        action: "market.updated",
        entityId: marketId,
        marketId,
        data: { fields: ["toneNotes", "preferredVocabulary", "forbiddenPatterns"] },
      }),
    ]);
  });

  it("rejects an invalid regex with a field path and saves nothing (M0-18 done-when)", async () => {
    const error = await updateMarket(editor, {
      marketId,
      toneNotes: "should not be saved",
      forbiddenPatterns: [
        { pattern: "delve", kind: "PHRASE", reason: "AI tell" },
        { pattern: "(unclosed", kind: "REGEX", reason: "broken" },
      ],
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors).toEqual({
      "forbiddenPatterns.1.pattern": ["Invalid regular expression"],
    });
    expect((await getMarketProfile(owner, "es-ES"))?.toneNotes).toBe("");
    expect(await auditRows()).toHaveLength(0);
  });

  it("rejects unknown time zones", async () => {
    await expect(
      updateMarket(editor, { marketId, timezone: "Europe/Atlantis" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("lets only owners change isActive", async () => {
    const fr = await getMarketProfile(owner, "fr-FR");
    await expect(
      updateMarket(editor, { marketId: fr?.id ?? "", isActive: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await updateMarket(owner, { marketId: fr?.id ?? "", isActive: true })).isActive).toBe(
      true,
    );
  });

  it("writes no audit row when nothing changed", async () => {
    await updateMarket(editor, {
      marketId,
      timezone: "Europe/Madrid",
      measurementSystem: "METRIC",
    });
    expect(await auditRows()).toHaveLength(0);
  });
});
