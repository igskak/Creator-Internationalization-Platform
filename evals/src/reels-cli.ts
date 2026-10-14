import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { EnvValidationError, loadServerEnv } from "@rc/lib/env";
import { createLlmProvider } from "@rc/lib/providers/llm";
import { STAGE_CONFIG } from "@rc/modules/ai";
import { REEL_POSTS } from "@rc/prompts/fixtures/reel-director";
import { createFakeEvalModel } from "./fake-model";
import {
  estimateReelEval,
  formatReelSummary,
  reelReviewSheet,
  runReelEval,
  summarizeReelEval,
} from "./reels";

// `pnpm eval:reels` (task M8-03, V-29): runs the Reel director on the three synthetic posts. Fake
// model by default (free); `--provider live` uses the model of .env, prints an estimate and asks.

const HELP = `pnpm eval:reels [options]

  --provider fake|live  fake: scripted answers, no cost (default). live: the model of .env (AI_PROVIDER=live)
  --posts a,b           only these post keys (${REEL_POSTS.map((p) => p.key).join(", ")})
  --yes                 do not ask for confirmation before a live run
  --out <dir>           where the report and the review sheet go (default: evals/results, not in git)
  --help`;

const args = { provider: "fake", posts: [] as string[], yes: false, out: "" };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  const value = () => argv[++i] ?? "";
  if (arg === "--provider") args.provider = value();
  else if (arg === "--posts") args.posts = value().split(",").filter(Boolean);
  else if (arg === "--yes") args.yes = true;
  else if (arg === "--out") args.out = value();
  else if (arg === "--help" || arg === "-h") {
    console.log(HELP);
    process.exit(0);
  } else {
    console.error(`eval:reels: unknown option ${arg}\n\n${HELP}`);
    process.exit(2);
  }
}
if (args.provider !== "fake" && args.provider !== "live") {
  console.error("eval:reels: --provider is fake or live.");
  process.exit(2);
}

const posts =
  args.posts.length > 0 ? REEL_POSTS.filter((p) => args.posts.includes(p.key)) : REEL_POSTS;
if (posts.length === 0) {
  console.error(`eval:reels: no post matches (${REEL_POSTS.map((p) => p.key).join(", ")}).`);
  process.exit(2);
}

let llm = createFakeEvalModel();
const model = args.provider === "fake" ? "scripted" : STAGE_CONFIG.REEL_DIRECTION.model;
if (args.provider === "live") {
  try {
    const env = loadServerEnv();
    if (env.ai.provider !== "live") {
      console.error("eval:reels: --provider live needs AI_PROVIDER=live in .env.");
      process.exit(1);
    }
    llm = createLlmProvider(env.ai);
  } catch (error) {
    if (!(error instanceof EnvValidationError)) throw error;
    console.error(`eval:reels: ${error.message}`);
    process.exit(1);
  }
  const estimate = estimateReelEval(posts.length);
  console.log(
    estimate.typicalUsd === null
      ? `${posts.length} model calls with ${model}; no price is known for this model.`
      : `${posts.length} model calls with ${model}: about $${estimate.typicalUsd.toFixed(2)} (up to $${(estimate.worstUsd ?? 0).toFixed(2)} with a repair each). A rough guess; the report shows the real cost.`,
  );
  if (!args.yes) {
    if (!process.stdin.isTTY) {
      console.error(
        "eval:reels: a live run needs confirmation; pass --yes when there is no terminal.",
      );
      process.exit(1);
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (
      await rl.question(`Run ${posts.length} post(s) with the live model? [y/N] `)
    ).trim();
    rl.close();
    if (!/^y(es)?$/i.test(answer)) {
      console.log("Cancelled.");
      process.exit(0);
    }
  }
}

const results = await runReelEval(posts, { llm });
const summary = summarizeReelEval(results);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = args.out ? resolve(args.out) : join(root, "results");
await mkdir(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const base = join(dir, `${stamp}-reels-${args.provider}`);
await writeFile(`${base}.json`, `${JSON.stringify({ model, summary, results }, null, 2)}\n`);
await writeFile(`${base}-review.md`, reelReviewSheet(posts, results));
console.log(`${formatReelSummary(summary, model)}\n`);
for (const r of results) {
  console.log(
    `${r.valid ? "ok  " : "FAIL"} ${r.key}  ${r.status}${r.seconds === null ? "" : ` · ${r.seconds} s`} · ${r.hookTypes.join(", ")}`,
  );
  for (const i of r.issues) console.log(`       ${i.severity} ${i.code} ${i.fieldPath ?? ""}`);
}
console.log(`\nResults: ${base}.json\nReview sheet: ${base}-review.md`);
process.exit(results.every((r) => r.valid) ? 0 : 1);
