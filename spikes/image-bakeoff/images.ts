// M3-15 throwaway, step 2: the first GENERATE slot of every visual brief, made by both candidate
// models through the app's OpenAI adapter (quality high). Writes the PNGs, the measured latency
// and token usage per image, and a random A/B order per brief for the blind review, to ./out
// (git-ignored). Usage: pnpm --filter @rc/cli exec tsx --env-file=../.env ../spikes/image-bakeoff/images.ts
import { randomInt } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, isPoolerUrl, schema } from "../../db/src/index";
import { eq, isNotNull } from "../../db/src/orm";
import { loadServerEnv } from "../../lib/src/env/index";
import { createOpenAIImageProvider } from "../../lib/src/providers/image/index";

const MODELS = ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"] as const;
const out = join(dirname(fileURLToPath(import.meta.url)), "out");
mkdirSync(out, { recursive: true });

const env = loadServerEnv();
if (env.ai.provider !== "live") throw new Error("AI_PROVIDER=live is needed");
const apiKey = env.ai.openaiApiKey;
const url = env.db.directUrl ?? env.db.url;
const { db, close } = createDb(url, { pooled: isPoolerUrl(url), max: 1 });

/** The adapter drops `usage`; keep the last one per call through a fetch wrapper. */
let lastUsage: unknown = null;
const recordingFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (response.ok) lastUsage = ((await response.clone().json()) as { usage?: unknown }).usage;
  return response;
};

type Row = {
  n: number;
  variantId: string;
  market: string;
  visualStyle: string;
  slideId: string;
  slot: string;
  aspect: string;
  prompt: string;
  negativePrompt: string | null;
  /** model → file, ms, usage, estimated cost or error. */
  results: Record<string, Record<string, unknown>>;
  /** Which model is shown as A and B in the review. */
  blind: { A: string; B: string };
};

try {
  const variants = await db
    .select({
      id: schema.contentVariants.id,
      brief: schema.contentVariants.visualBriefJson,
      market: schema.markets.code,
    })
    .from(schema.contentVariants)
    .innerJoin(schema.markets, eq(schema.markets.id, schema.contentVariants.marketId))
    .where(isNotNull(schema.contentVariants.visualBriefJson))
    .orderBy(schema.contentVariants.createdAt);

  const rows: Row[] = [];
  for (const [i, v] of variants.entries()) {
    const slot = v.brief?.slides.find((s) => s.source === "GENERATE" && s.prompt?.trim());
    if (!v.brief || !slot?.prompt) continue;
    const flip = randomInt(2) === 1;
    const row: Row = {
      n: i + 1,
      variantId: v.id,
      market: v.market,
      visualStyle: v.brief.visualStyle,
      slideId: slot.slideId,
      slot: slot.slot,
      aspect: slot.aspect,
      prompt: slot.prompt,
      negativePrompt: slot.negativePrompt ?? null,
      results: {},
      blind: flip ? { A: MODELS[1], B: MODELS[0] } : { A: MODELS[0], B: MODELS[1] },
    };
    for (const model of MODELS) {
      const provider = createOpenAIImageProvider({ apiKey, model, fetch: recordingFetch });
      const t0 = Date.now();
      try {
        lastUsage = null;
        const image = await provider.generate({
          prompt: slot.prompt,
          ...(slot.negativePrompt ? { negativePrompt: slot.negativePrompt } : {}),
          aspect: slot.aspect,
        });
        const file = `${row.n}-${model}.png`;
        writeFileSync(join(out, file), image.bytes);
        row.results[model] = {
          file,
          ms: Date.now() - t0,
          usage: lastUsage,
          estimatedCostUsd: image.costUsd,
          params: image.params,
        };
        console.log(`ok   #${row.n} ${model} ${Date.now() - t0} ms`);
      } catch (error) {
        row.results[model] = { error: error instanceof Error ? error.message : String(error) };
        console.log(`FAIL #${row.n} ${model} ${error instanceof Error ? error.message : error}`);
      }
    }
    rows.push(row);
    writeFileSync(join(out, "results.json"), JSON.stringify(rows, null, 2));
  }
  console.log(`${rows.length} briefs written to ${out}`);
} finally {
  await close();
}
