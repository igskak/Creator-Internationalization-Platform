import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../schema";
import { BRAND_SLUG, brand } from "./brand";
import { marketSeeds } from "./markets";
import { settingSeeds } from "./settings";
import { taxonomySeeds } from "./taxonomy";

type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>;

export type SeedOptions = {
  /** Lower-case emails that get an active `owner` account. */
  ownerEmails: string[];
};

export type SeedResult = Record<
  "brands" | "markets" | "taxonomyTerms" | "owners" | "settings",
  number
>;

/**
 * Idempotent seed (plan 04 §4.7 rule 5). Inserts only missing rows and never changes existing
 * ones, so edits made in the app survive a re-run. Returns the number of rows inserted per table.
 */
export async function seedDatabase(db: AnyDb, { ownerEmails }: SeedOptions): Promise<SeedResult> {
  return db.transaction(async (tx) => {
    const insertedBrands = await tx
      .insert(schema.brands)
      .values(brand)
      .onConflictDoNothing()
      .returning({ id: schema.brands.id });
    const [regchef] = await tx
      .select({ id: schema.brands.id })
      .from(schema.brands)
      .where(eq(schema.brands.slug, BRAND_SLUG));
    if (!regchef) throw new Error("seed: brand row missing after insert");

    const insertedMarkets = await tx
      .insert(schema.markets)
      .values(marketSeeds.map((m) => ({ ...m, brandId: regchef.id })))
      .onConflictDoNothing()
      .returning({ id: schema.markets.id });

    const insertedTerms = await tx
      .insert(schema.taxonomyTerms)
      .values(taxonomySeeds)
      .onConflictDoNothing()
      .returning({ id: schema.taxonomyTerms.id });

    const owners = [...new Set(ownerEmails.map((e) => e.trim().toLowerCase()))];
    const insertedOwners =
      owners.length === 0
        ? []
        : await tx
            .insert(schema.appUsers)
            .values(owners.map((email) => ({ email, role: "owner" as const })))
            .onConflictDoNothing()
            .returning({ id: schema.appUsers.id });

    const insertedSettings = await tx
      .insert(schema.appSettings)
      .values(settingSeeds)
      .onConflictDoNothing()
      .returning({ key: schema.appSettings.key });

    return {
      brands: insertedBrands.length,
      markets: insertedMarkets.length,
      taxonomyTerms: insertedTerms.length,
      owners: insertedOwners.length,
      settings: insertedSettings.length,
    };
  });
}

export { BRAND_SLUG } from "./brand";
export { marketSeeds } from "./markets";
export { rightsDefaults, settingSeeds } from "./settings";
export { labelFromCode, taxonomySeeds } from "./taxonomy";
