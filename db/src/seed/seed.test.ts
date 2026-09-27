import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RightsDefaults, SOURCE_TYPES } from "../json";
import { appSettings, appUsers, brands, markets, taxonomyTerms } from "../schema";
import { createTestDb, type TestDb } from "../test-db";
import { labelFromCode, seedDatabase, taxonomySeeds } from "./index";

const ownerEmails = ["ihor@example.com", "Sergey@Example.com"];

async function snapshot(t: TestDb) {
  const tables = ["brands", "markets", "taxonomy_terms", "app_users", "app_settings"];
  const out: Record<string, unknown[]> = {};
  for (const table of tables) {
    const result = await t.db.execute(sql.raw(`select * from ${table} order by 1`));
    out[table] = result.rows;
  }
  return out;
}

describe("seedDatabase", () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
  });

  afterEach(async () => {
    await t.close();
  });

  it("inserts brand, markets, taxonomy, owners and settings", async () => {
    const inserted = await seedDatabase(t.db, { ownerEmails });
    expect(inserted).toEqual({
      brands: 1,
      markets: 3,
      taxonomyTerms: taxonomySeeds.length,
      owners: 2,
      settings: 4,
    });
  });

  it("gives identical rows when run twice", async () => {
    await seedDatabase(t.db, { ownerEmails });
    const first = await snapshot(t);
    const second = await seedDatabase(t.db, { ownerEmails });
    expect(second).toEqual({ brands: 0, markets: 0, taxonomyTerms: 0, owners: 0, settings: 0 });
    expect(await snapshot(t)).toEqual(first);
  });

  it("uses the A-06 market defaults", async () => {
    await seedDatabase(t.db, { ownerEmails });
    const rows = await t.db
      .select({
        code: markets.code,
        currency: markets.currency,
        timezone: markets.timezone,
        measurementSystem: markets.measurementSystem,
        isActive: markets.isActive,
      })
      .from(markets)
      .orderBy(markets.sortOrder);
    expect(rows).toEqual([
      {
        code: "es-ES",
        currency: "EUR",
        timezone: "Europe/Madrid",
        measurementSystem: "METRIC",
        isActive: true,
      },
      {
        code: "en",
        currency: "USD",
        timezone: "America/New_York",
        measurementSystem: "DUAL",
        isActive: true,
      },
      {
        code: "fr-FR",
        currency: "EUR",
        timezone: "Europe/Paris",
        measurementSystem: "METRIC",
        isActive: false,
      },
    ]);
  });

  it("creates active owners with lower-case emails", async () => {
    await seedDatabase(t.db, { ownerEmails });
    const users = await t.db
      .select({ email: appUsers.email, role: appUsers.role, isActive: appUsers.isActive })
      .from(appUsers)
      .orderBy(appUsers.email);
    expect(users).toEqual([
      { email: "ihor@example.com", role: "owner", isActive: true },
      { email: "sergey@example.com", role: "owner", isActive: true },
    ]);
  });

  it("seeds safe settings and UNKNOWN rights for every source type", async () => {
    await seedDatabase(t.db, { ownerEmails });
    const settings = Object.fromEntries(
      (await t.db.select().from(appSettings)).map((s) => [s.key, s.value]),
    );
    expect(settings["publishing.enabled"]).toBe(false);
    expect(settings["publishing.min_gap_minutes"]).toBe(180);
    expect(settings["analytics.min_sample"]).toBe(3);
    const rights = RightsDefaults.parse(settings["rights.defaults"]);
    expect(Object.keys(rights).sort()).toEqual([...SOURCE_TYPES].sort());
    expect(rights.BOOK.aiProcessing).toBe("UNKNOWN");
  });

  it("never overwrites rows edited in the app", async () => {
    await seedDatabase(t.db, { ownerEmails });
    await t.db.update(brands).set({ brandVoice: "# Edited voice" });
    await t.db
      .update(taxonomyTerms)
      .set({ label: "Fish & seafood" })
      .where(eq(taxonomyTerms.code, "FISH_SEAFOOD"));
    await t.db
      .update(appUsers)
      .set({ role: "chef" })
      .where(eq(appUsers.email, "sergey@example.com"));
    await t.db
      .update(appSettings)
      .set({ value: true })
      .where(eq(appSettings.key, "publishing.enabled"));

    await seedDatabase(t.db, { ownerEmails });

    const [brand] = await t.db.select().from(brands);
    expect(brand?.brandVoice).toBe("# Edited voice");
    const [term] = await t.db
      .select()
      .from(taxonomyTerms)
      .where(eq(taxonomyTerms.code, "FISH_SEAFOOD"));
    expect(term?.label).toBe("Fish & seafood");
    const [sergey] = await t.db
      .select()
      .from(appUsers)
      .where(eq(appUsers.email, "sergey@example.com"));
    expect(sergey?.role).toBe("chef");
    const [enabled] = await t.db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, "publishing.enabled"));
    expect(enabled?.value).toBe(true);
  });

  it("adds a new owner on a later run without touching others", async () => {
    await seedDatabase(t.db, { ownerEmails: ["ihor@example.com"] });
    const inserted = await seedDatabase(t.db, {
      ownerEmails: ["ihor@example.com", "new@example.com"],
    });
    expect(inserted.owners).toBe(1);
  });
});

describe("taxonomy seed", () => {
  it("covers every kind from plan 04 §4.7 with unique codes per kind", () => {
    const counts: Record<string, number> = {};
    const keys = new Set<string>();
    for (const term of taxonomySeeds) {
      counts[term.kind] = (counts[term.kind] ?? 0) + 1;
      keys.add(`${term.kind}:${term.code}`);
    }
    expect(counts).toEqual({
      category: 14,
      angle: 10,
      hook_type: 10,
      cta_type: 7,
      visual_style: 6,
      reason_code: 13,
    });
    expect(keys.size).toBe(taxonomySeeds.length);
  });

  it("derives readable labels", () => {
    expect(labelFromCode("FISH_SEAFOOD")).toBe("Fish seafood");
    expect(labelFromCode("MYTH_VS_FACT")).toBe("Myth vs fact");
    expect(labelFromCode("DM_KEYWORD")).toBe("DM keyword");
  });
});
