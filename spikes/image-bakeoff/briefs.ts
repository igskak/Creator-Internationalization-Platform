// M3-15 throwaway, step 1: plan the pictures (visual-director, a real model call) of every
// READY_FOR_REVIEW variant that has no visual brief yet, through the app's own service.
// Usage: pnpm --filter @rc/cli exec tsx --env-file=../.env ../spikes/image-bakeoff/briefs.ts
// Imports are relative so the script resolves the workspace packages without being one.
import { createDb, isPoolerUrl, schema } from "../../db/src/index";
import { and, eq, isNull } from "../../db/src/orm";
import { loadServerEnv } from "../../lib/src/env/index";
import { createLogger } from "../../lib/src/logging/index";
import { createEmbeddingProvider } from "../../lib/src/providers/embeddings/index";
import { createImageProvider } from "../../lib/src/providers/image/index";
import { createLlmProvider } from "../../lib/src/providers/llm/index";
import { createStorage } from "../../lib/src/providers/storage/index";
import { regenerateVisualBrief } from "../../modules/src/content/visual/index";
import { createServiceContext } from "../../modules/src/core/index";

const env = loadServerEnv();
if (env.appEnv === "production") throw new Error("refusing production");
const url = env.db.directUrl ?? env.db.url;
const { db, close } = createDb(url, { pooled: isPoolerUrl(url), max: 1 });
const logger = createLogger({ service: "bakeoff", env: env.appEnv, level: "warn" });
const ctx = createServiceContext({
  db,
  logger,
  storage: createStorage(env.storage),
  llm: createLlmProvider(env.ai),
  embeddings: createEmbeddingProvider(env.ai),
  images: createImageProvider(env.ai),
  actor: { type: "SYSTEM" },
});

try {
  const variants = await db
    .select({ id: schema.contentVariants.id })
    .from(schema.contentVariants)
    .where(
      and(
        eq(schema.contentVariants.status, "READY_FOR_REVIEW"),
        isNull(schema.contentVariants.visualBriefJson),
      ),
    )
    .orderBy(schema.contentVariants.createdAt);
  console.log(`${variants.length} variants without a brief`);
  for (const { id } of variants) {
    try {
      const { visualBrief } = await regenerateVisualBrief(ctx, { variantId: id });
      const generate = visualBrief.slides.filter((s) => s.source === "GENERATE");
      console.log(`ok   ${id}  ${visualBrief.visualStyle}  ${generate.length} to generate`);
    } catch (error) {
      console.log(`FAIL ${id}  ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} finally {
  await close();
}
