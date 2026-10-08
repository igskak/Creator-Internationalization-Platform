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

export const E2E_EDITOR_EMAIL = "e2e-editor@regchef.test";

/** An active user the tests sign in as (the magic-link allowlist is the `app_users` table); a chef by default. */
export async function ensureE2eUser(
  email: string = E2E_EMAIL,
  role: "chef" | "editor" = "chef",
): Promise<void> {
  const { db, close } = openDb();
  try {
    const [existing] = await db
      .select({ id: schema.appUsers.id })
      .from(schema.appUsers)
      .where(eq(schema.appUsers.email, email));
    if (existing) {
      await db
        .update(schema.appUsers)
        .set({ role, isActive: true })
        .where(eq(schema.appUsers.id, existing.id));
    } else {
      await db
        .insert(schema.appUsers)
        .values({ email, displayName: `E2E ${role}`, role, isActive: true });
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

const EMBEDDING_DIMENSIONS = 1536;
const axis = (i: number) => {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  v[i % EMBEDDING_DIMENSIONS] = 1;
  return v;
};

/**
 * A source with two approved cards (with a vector and an approved version), so that ideas can be
 * made from them without running the whole ingestion. Titles start with `E2E source` / `E2E card`.
 */
export async function seedApprovedCards(sourceTitle: string): Promise<{ cardTitles: string[] }> {
  const { db, close } = openDb();
  try {
    const [brand] = await db.select({ id: schema.brands.id }).from(schema.brands).limit(1);
    if (!brand) throw new Error("The database has no brand: run `pnpm db:seed`.");
    const [source] = await db
      .insert(schema.sourceAssets)
      .values({
        brandId: brand.id,
        type: "NOTE",
        title: sourceTitle,
        originalLanguage: "en",
        rights: {
          use: "ALLOWED",
          translate: "ALLOWED",
          adapt: "ALLOWED",
          visuallyTransform: "UNKNOWN",
          sell: "UNKNOWN",
          aiProcessing: "ALLOWED",
          improvePrompts: "UNKNOWN",
        },
        processingStatus: "READY",
      })
      .returning({ id: schema.sourceAssets.id });
    const cards = [
      {
        title: "E2E card A: rinsing rice",
        claim: "Risotto rice is not rinsed: the surface starch makes it creamy.",
      },
      {
        title: "E2E card B: water ratio",
        claim: "Long-grain rice stays fluffy at two parts water to one part rice.",
      },
    ];
    for (const [i, card] of cards.entries()) {
      const [row] = await db
        .insert(schema.knowledgeItems)
        .values({
          brandId: brand.id,
          title: card.title,
          category: "GRAINS_RICE_PASTA",
          claim: card.claim,
          language: "en",
          origin: "MANUAL",
          reviewStatus: "CHEF_APPROVED",
          version: 1,
          approvedVersion: 1,
          approvedAt: new Date(),
          sourceAssetId: source?.id ?? null,
          embedding: axis(i + 1),
          embeddingModel: "e2e-fake",
        })
        .returning({ id: schema.knowledgeItems.id });
      await db.insert(schema.knowledgeItemVersions).values({
        knowledgeItemId: row?.id ?? "",
        version: 1,
        status: "CHEF_APPROVED",
        snapshot: {
          title: card.title,
          category: "GRAINS_RICE_PASTA",
          subcategory: null,
          claim: card.claim,
          explanation: "",
          procedure: [],
          ingredients: [],
          temperatures: [],
          timings: [],
          commonMistakes: [],
          sourceReference: null,
          language: "en",
          safetySensitive: false,
          safetyNotes: null,
          tags: [],
        },
      });
    }
    return { cardTitles: cards.map((c) => c.title) };
  } finally {
    await close();
  }
}

/** Removes the ideas that use the cards of a source the test seeded, with their links and model runs. */
export async function removeIdeasOfSource(sourceTitle: string): Promise<void> {
  const { db, close } = openDb();
  try {
    const sources = await db
      .select({ id: schema.sourceAssets.id })
      .from(schema.sourceAssets)
      .where(eq(schema.sourceAssets.title, sourceTitle));
    const sourceIds = sources.map((s) => s.id);
    if (sourceIds.length === 0) return;
    const cards = await db
      .select({ id: schema.knowledgeItems.id })
      .from(schema.knowledgeItems)
      .where(inArray(schema.knowledgeItems.sourceAssetId, sourceIds));
    const cardIds = cards.map((c) => c.id);
    if (cardIds.length === 0) return;
    const links = await db
      .select({ ideaId: schema.masterIdeaKnowledge.masterIdeaId })
      .from(schema.masterIdeaKnowledge)
      .where(inArray(schema.masterIdeaKnowledge.knowledgeItemId, cardIds));
    const ideaIds = [...new Set(links.map((l) => l.ideaId))];
    if (ideaIds.length === 0) return;
    const ideas = await db
      .select({ runId: schema.masterIdeas.generationRunId })
      .from(schema.masterIdeas)
      .where(inArray(schema.masterIdeas.id, ideaIds));
    const runIds = ideas.flatMap((i) => (i.runId ? [i.runId] : []));
    await db
      .delete(schema.masterIdeaKnowledge)
      .where(inArray(schema.masterIdeaKnowledge.masterIdeaId, ideaIds));
    await db.delete(schema.masterIdeas).where(inArray(schema.masterIdeas.id, ideaIds));
    if (runIds.length > 0) {
      await db.delete(schema.generationRuns).where(inArray(schema.generationRuns.id, runIds));
    }
  } finally {
    await close();
  }
}

/** Removes the products a test created (their code starts with the prefix) with their offers. */
export async function removeProductsByCodePrefix(prefix: string): Promise<void> {
  const { db, close } = openDb();
  try {
    const products = await db
      .select({ id: schema.products.id, code: schema.products.code })
      .from(schema.products);
    const ids = products.filter((p) => p.code.startsWith(prefix)).map((p) => p.id);
    if (ids.length === 0) return;
    await db.delete(schema.offers).where(inArray(schema.offers.productId, ids));
    await db.delete(schema.products).where(inArray(schema.products.id, ids));
  } finally {
    await close();
  }
}
