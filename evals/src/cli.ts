import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { EnvValidationError, loadServerEnv } from "@rc/lib/env";
import { createEmbeddingProvider, type EmbeddingProvider } from "@rc/lib/providers/embeddings";
import { createLlmProvider } from "@rc/lib/providers/llm";
import { STAGE_CONFIG } from "@rc/modules/ai";
import { exportBlind } from "./blind";
import { loadCases } from "./case";
import { describeEstimate, estimateRun } from "./cost";
import { createFakeEvalEmbeddings, createFakeEvalModel } from "./fake-model";
import { buildReport, summarize, writeReport } from "./report";
import { type CaseOutcome, runCase } from "./runner";

// `pnpm eval` (plan 07 §7.12, M2-16): runs an eval set through the real pipeline in a throw-away
// database and writes a report. The default is the fake model (free, proves the harness). A live
// run costs money: it prints an estimate and waits for a yes, never part of PR CI.

const HELP = `pnpm eval [options]

  --set <name|path>     a set under evals/sets, or the path of a set folder (default: synthetic)
  --provider fake|live  fake: scripted model, no cost (default). live: the model of .env (AI_PROVIDER=live)
  --judge               also score every draft with eval-judge@1
  --cases a,b           only these case ids
  --yes                 do not ask for confirmation before a live run
  --blind               also write the blind review sheet (Markdown + CSV) and its key
  --out <dir>           where results go (default: evals/results, not in git)
  --help`;

function parse(argv: string[]) {
  const args = {
    set: "synthetic",
    provider: "fake",
    judge: false,
    yes: false,
    blind: false,
    cases: [] as string[],
    out: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => argv[++i] ?? "";
    if (arg === "--set") args.set = value();
    else if (arg === "--provider") args.provider = value();
    else if (arg === "--judge") args.judge = true;
    else if (arg === "--yes") args.yes = true;
    else if (arg === "--blind") args.blind = true;
    else if (arg === "--cases") args.cases = value().split(",").filter(Boolean);
    else if (arg === "--out") args.out = value();
    else if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      process.exit(0);
    } else {
      console.error(`eval: unknown option ${arg}\n\n${HELP}`);
      process.exit(2);
    }
  }
  if (args.provider !== "fake" && args.provider !== "live") {
    console.error("eval: --provider is fake or live.");
    process.exit(2);
  }
  return { ...args, provider: args.provider as "fake" | "live" };
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parse(process.argv.slice(2));
const setDir = existsSync(join(root, "sets", args.set))
  ? join(root, "sets", args.set)
  : resolve(args.set);
if (!existsSync(join(setDir, "cases"))) {
  console.error(`eval: no cases folder in ${setDir}.`);
  process.exit(2);
}

const all = await loadCases(setDir);
const cases = args.cases.length > 0 ? all.filter((c) => args.cases.includes(c.id)) : all;
if (cases.length === 0) {
  console.error(`eval: no case matches (${all.map((c) => c.id).join(", ")}).`);
  process.exit(2);
}

let llm = createFakeEvalModel();
let embeddings: EmbeddingProvider = createFakeEvalEmbeddings();
const model = args.provider === "fake" ? "scripted" : STAGE_CONFIG.CONTENT_WRITING.model;
if (args.provider === "live") {
  try {
    const env = loadServerEnv();
    if (env.ai.provider !== "live") {
      console.error("eval: --provider live needs AI_PROVIDER=live in .env.");
      process.exit(1);
    }
    llm = createLlmProvider(env.ai);
    embeddings = createEmbeddingProvider(env.ai);
  } catch (error) {
    if (!(error instanceof EnvValidationError)) throw error;
    console.error(`eval: ${error.message}`);
    process.exit(1);
  }
  console.log(describeEstimate(estimateRun(cases, { judge: args.judge }), model));
  if (!args.yes) {
    if (!process.stdin.isTTY) {
      console.error("eval: a live run needs confirmation; pass --yes when there is no terminal.");
      process.exit(1);
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (
      await rl.question(`Run ${cases.length} case(s) with the live model? [y/N] `)
    ).trim();
    rl.close();
    if (!/^y(es)?$/i.test(answer)) {
      console.log("Cancelled.");
      process.exit(0);
    }
  }
}

const startedAt = new Date().toISOString();
const outcomes: CaseOutcome[] = [];
for (const evalCase of cases) {
  process.stdout.write(`running ${evalCase.id} … `);
  const outcome = await runCase(evalCase, { llm, embeddings, judge: args.judge });
  outcomes.push(outcome);
  console.log(
    `${outcome.variants.filter((v) => v.hasContent).length}/${outcome.variants.length} drafts, ${(outcome.pipelineMs / 1000).toFixed(1)} s`,
  );
}

const report = buildReport(outcomes, {
  set: basename(setDir),
  provider: args.provider,
  model,
  judge: args.judge,
  startedAt,
});
const resultsDir = args.out ? resolve(args.out) : join(root, "results");
const file = await writeReport(report, resultsDir);
console.log(`\n${summarize(report)}\n\nResults: ${file}`);

if (args.blind) {
  const sheet = exportBlind(outcomes);
  const base = file.replace(/\.json$/, "");
  await writeFile(`${base}-blind.md`, sheet.markdown);
  await writeFile(`${base}-blind.csv`, sheet.csv);
  await writeFile(`${base}-blind-key.json`, `${JSON.stringify(sheet.key, null, 2)}\n`);
  console.log(
    `Blind sheet: ${base}-blind.md, ${base}-blind.csv (key: ${base}-blind-key.json — keep it from the reviewers)`,
  );
}
process.exit(report.cases.every((c) => c.meetsExpectations) ? 0 : 1);
