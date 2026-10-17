// Read-only: lists recent carousel variants, or saves one variant's text and brief (post.json),
// its pictures (photo-<slideId>-<slot>.<ext>) and its idea's approved cards as the director's
// recipe (recipe.json), for `bench:visuals` and `bench:carousel`. Output goes to a git-ignored
// folder (real content never goes into git).
//   tsx --env-file=<.env> spikes/carousel-v3/fetch-post.ts            # list
//   tsx --env-file=<.env> spikes/carousel-v3/fetch-post.ts <variantId> <outDir>
import { mkdir, writeFile } from "node:fs/promises";
import { createDb } from "../../db/src/client";
import { createR2Storage } from "../../lib/src/providers/storage/index";
import type { ServiceContext } from "../../modules/src/core";
import { getIdeaCards } from "../../modules/src/knowledge/retrieval/service";

const [variantId, outDir] = process.argv.slice(2);
const env = process.env;
const url = env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL missing");
const { db, close } = createDb(url, { pooled: url.includes(":6543"), max: 1 });
const sql = (db as unknown as { $client: { unsafe: (q: string, p?: unknown[]) => Promise<any[]> } })
  .$client;
try {
  if (!variantId || !outDir) {
    const rows = await sql.unsafe(
      `select v.id, v.status, m.code as market, v.format, left(v.hook, 70) as hook, v.created_at
         from content_variants v join markets m on m.id = v.market_id
        order by v.created_at desc limit 30`,
    );
    for (const r of rows) console.log(r.id, r.status, r.market, r.format ?? "", r.hook);
  } else {
    if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET)
      throw new Error("R2 env missing");
    const storage = createR2Storage({
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: env.R2_BUCKET,
      jurisdiction: env.R2_JURISDICTION === "eu" ? "eu" : undefined,
    });
    await mkdir(outDir, { recursive: true });
    const [v] = await sql.unsafe(
      `select hook, caption, cta, hashtags, slides_json, visual_brief_json, master_idea_id
         from content_variants where id = $1`,
      [variantId],
    );
    if (!v) throw new Error("variant not found");
    await writeFile(`${outDir}/post.json`, JSON.stringify(v, null, 2));
    const assets = await sql.unsafe(
      `select slide_id, slot, storage_key from visual_assets
        where content_variant_id = $1 and status = 'READY' order by created_at`,
      [variantId],
    );
    for (const a of assets) {
      const bytes = await storage.getBytes(a.storage_key);
      const ext = a.storage_key.split(".").pop() ?? "png";
      await writeFile(`${outDir}/photo-${a.slide_id}-${a.slot}.${ext}`, bytes);
    }
    const cards = await getIdeaCards({ db } as unknown as ServiceContext, v.master_idea_id);
    await writeFile(`${outDir}/recipe.json`, JSON.stringify(cards, null, 2));
    // The same idea as an eval case (evals/src/case.ts) for spikes/carousel-v3/generate-post.ts.
    const [idea] = await sql.unsafe(
      `select topic, category, angle, core_message from master_ideas where id = $1`,
      [v.master_idea_id],
    );
    const evalCase = {
      id: "real-post",
      description: `Read-only copy of variant ${variantId}'s idea.`,
      idea: {
        topic: idea.topic,
        category: idea.category,
        angle: idea.angle,
        coreMessage: idea.core_message,
      },
      cards: cards.map((c, i) => ({
        key: `card-${i + 1}`,
        role: c.role,
        title: c.title,
        category: c.category,
        claim: c.claim,
        explanation: c.explanation ?? "",
        procedure: c.procedure ?? [],
        ingredients: c.ingredients ?? [],
        temperatures: c.temperatures ?? [],
        timings: c.timings ?? [],
        commonMistakes: c.commonMistakes ?? [],
        safetySensitive: c.safetySensitive ?? false,
        safetyNotes: c.safetyNotes ?? null,
        language: c.language ?? "ru",
      })),
      markets: ["en"],
      expect: { mustCite: [], forbiddenPhrases: [], requiredText: [], hookTypesDiffer: false },
    };
    await mkdir(`${outDir}/case`, { recursive: true });
    await writeFile(`${outDir}/case/real-post.json`, JSON.stringify(evalCase, null, 2));
    console.log(`${outDir}: ${v.slides_json.length} slides, ${assets.length} pictures, ${cards.length} cards`);
  }
} finally {
  await close();
}
