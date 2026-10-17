// `tsx --env-file=<.env> spikes/carousel-v3/generate-post.ts --case <case.json> --out <dir>`: runs
// the active text pipeline (planner, writer, critic, visual director) on one eval case in a
// throw-away database, like `pnpm eval`, and writes each market's variant as `<out>/<market>/post.json`
// (the shape of `fetch-post.ts`), ready for `visual-bench.ts --use-brief` and `bench:carousel`.
// Costs money (live model of .env). Real content stays out of git: point --out at a git-ignored folder.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { EvalCase } from "../../evals/src/case";
import { runCase } from "../../evals/src/runner";
import { loadServerEnv } from "../../lib/src/env";
import { createEmbeddingProvider } from "../../lib/src/providers/embeddings";
import { createLlmProvider } from "../../lib/src/providers/llm";

const arg = (name: string) => {
  const at = process.argv.indexOf(`--${name}`);
  const value = at >= 0 ? process.argv[at + 1] : undefined;
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
};

const env = loadServerEnv();
if (env.ai.provider !== "live") throw new Error("AI_PROVIDER=live is needed.");
const evalCase = EvalCase.parse(JSON.parse(await readFile(arg("case"), "utf8")));
const out = arg("out");
const outcome = await runCase(evalCase, {
  llm: createLlmProvider(env.ai),
  embeddings: createEmbeddingProvider(env.ai),
  judge: false,
});
for (const v of outcome.variants) {
  await mkdir(`${out}/${v.marketCode}`, { recursive: true });
  await writeFile(
    `${out}/${v.marketCode}/post.json`,
    JSON.stringify(
      {
        hook: v.hook,
        caption: v.caption,
        cta: v.cta,
        hashtags: v.hashtags,
        slides_json: v.slides,
        visual_brief_json: v.visualBrief,
        status: v.status,
        flags: v.flags,
        critic: v.critic,
      },
      null,
      2,
    ),
  );
}
console.log(
  `${outcome.variants.map((v) => `${v.marketCode}: ${v.status} ${v.slides.length} slides`).join("; ")}; $${outcome.pipelineCostUsd.toFixed(3)}`,
);
if (outcome.failed.length) console.log("failed:", JSON.stringify(outcome.failed));
