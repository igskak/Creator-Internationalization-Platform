import { createDb, isPoolerUrl, schema } from "@rc/db";
import { eq, inArray } from "@rc/db/orm";
import { loadServerEnv, runtimeDatabaseUrl } from "@rc/lib/env";

// Database helpers of the E2E tests: a user to sign in as, and removal of what a test created.

export const E2E_EMAIL = "e2e-chef@regchef.test";

try {
  // The repository's .env has the dev project's database and Supabase settings.
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // Variables may come from the environment instead (CI).
}

export function openDb() {
  const env = loadServerEnv();
  const url = runtimeDatabaseUrl(env.db, env.appEnv);
  return createDb(url, { pooled: isPoolerUrl(url), max: 1 });
}

/** An active chef the tests sign in as (the magic-link allowlist is the `app_users` table). */
export async function ensureE2eUser(): Promise<void> {
  const { db, close } = openDb();
  try {
    const [existing] = await db
      .select({ id: schema.appUsers.id })
      .from(schema.appUsers)
      .where(eq(schema.appUsers.email, E2E_EMAIL));
    if (existing) {
      await db
        .update(schema.appUsers)
        .set({ role: "chef", isActive: true })
        .where(eq(schema.appUsers.id, existing.id));
    } else {
      await db
        .insert(schema.appUsers)
        .values({ email: E2E_EMAIL, displayName: "E2E chef", role: "chef", isActive: true });
    }
  } finally {
    await close();
  }
}

/** Removes a source the test created with its cards, versions, batches and model runs. */
export async function removeSourceByTitle(title: string): Promise<void> {
  const { db, close } = openDb();
  try {
    const sources = await db
      .select({ id: schema.sourceAssets.id })
      .from(schema.sourceAssets)
      .where(eq(schema.sourceAssets.title, title));
    const ids = sources.map((s) => s.id);
    if (ids.length === 0) return;
    const cards = await db
      .select({ id: schema.knowledgeItems.id })
      .from(schema.knowledgeItems)
      .where(inArray(schema.knowledgeItems.sourceAssetId, ids));
    const cardIds = cards.map((c) => c.id);
    if (cardIds.length > 0) {
      await db
        .delete(schema.knowledgeItemVersions)
        .where(inArray(schema.knowledgeItemVersions.knowledgeItemId, cardIds));
      await db.delete(schema.knowledgeItems).where(inArray(schema.knowledgeItems.id, cardIds));
    }
    await db
      .delete(schema.knowledgeExtractionBatches)
      .where(inArray(schema.knowledgeExtractionBatches.sourceAssetId, ids));
    await db.delete(schema.generationRuns).where(inArray(schema.generationRuns.sourceAssetId, ids));
    await db.delete(schema.sourceAssets).where(inArray(schema.sourceAssets.id, ids));
  } finally {
    await close();
  }
}
