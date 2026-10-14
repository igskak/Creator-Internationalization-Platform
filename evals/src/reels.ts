import { performance } from "node:perf_hooks";
import type { ValidationIssue } from "@rc/db/json";
import { createTestDb } from "@rc/db/test-db";
import { createLogger } from "@rc/lib/logging";
import type { LLMProvider } from "@rc/lib/providers/llm";
import { computeCostUsd, STAGE_CONFIG } from "@rc/modules/ai";
import { createServiceContext } from "@rc/modules/core";
import { directReel, type ReelScriptDraft } from "@rc/modules/reels";
import { REEL_LIMITS } from "@rc/prompts";
import type { ReelPost } from "@rc/prompts/fixtures/reel-director";

// Eval of the Reel director (task M8-03, verification V-29): each post (an approved carousel and
// its pictures) goes through the real `directReel` stage in a throw-away database, and what came
// out is checked by the same validators the pipeline uses. Hook quality and claim fidelity are
// judged by the owner on the review sheet; the numbers here only prove the rules hold. A fake
// model costs nothing; a live run prints an estimate first (reels-cli.ts).

export type ReelEvalResult = {
  key: string;
  status: string;
  /** The script passed every blocking check (possibly after the one repair). */
  valid: boolean;
  repaired: boolean;
  /** Notes left on a valid script (MAJOR and MINOR issues), or the blocking ones when invalid. */
  issues: ValidationIssue[];
  script: ReelScriptDraft | null;
  hookTypes: string[];
  seconds: number | null;
  costUsd: number | null;
  ms: number;
};

export type ReelEvalSummary = {
  posts: number;
  valid: number;
  repaired: number;
  /** Mean number of notes per valid script. */
  notes: number;
  costUsd: number | null;
  ms: number;
};

const silent = createLogger({
  service: "jobs",
  env: "test",
  level: "fatal",
  destination: { write: () => {} },
});

const LOCALES = { "es-ES": "es-ES", en: "en" } as const;

export async function runReelEval(
  posts: readonly ReelPost[],
  options: { llm: LLMProvider },
): Promise<ReelEvalResult[]> {
  const results: ReelEvalResult[] = [];
  const t = await createTestDb();
  try {
    for (const post of posts) {
      const ctx = createServiceContext({
        db: t.db,
        logger: silent,
        actor: { type: "SYSTEM" },
        llm: options.llm,
      });
      const started = performance.now();
      const directed = await directReel(ctx, post.input, {
        locale: LOCALES[post.input.market.code as keyof typeof LOCALES] ?? "en",
      });
      const script = directed.script;
      const chosen = script?.hookOptions.find((h) => h.id === script.chosenHookId);
      results.push({
        key: post.key,
        status: directed.status,
        valid: script !== null,
        repaired: directed.status === "REPAIRED",
        issues: directed.issues,
        script,
        hookTypes: script?.hookOptions.map((h) => h.hookType) ?? [],
        seconds: script
          ? script.scenes.reduce((sum, s) => sum + s.beats, 0) * REEL_LIMITS.secondsPerBeat
          : null,
        costUsd: directed.costUsd,
        ms: performance.now() - started,
      });
      if (chosen === undefined && script) throw new Error(`${post.key}: no chosen hook.`);
    }
  } finally {
    await t.close();
  }
  return results;
}

export function summarizeReelEval(results: readonly ReelEvalResult[]): ReelEvalSummary {
  const valid = results.filter((r) => r.valid);
  const costs = results.map((r) => r.costUsd);
  return {
    posts: results.length,
    valid: valid.length,
    repaired: results.filter((r) => r.repaired).length,
    notes: valid.length === 0 ? 0 : valid.reduce((n, r) => n + r.issues.length, 0) / valid.length,
    costUsd: costs.some((c) => c === null) ? null : (costs as number[]).reduce((a, b) => a + b, 0),
    ms: results.reduce((sum, r) => sum + r.ms, 0),
  };
}

export function formatReelSummary(s: ReelEvalSummary, model: string): string {
  return [
    `Reel director eval · ${model}`,
    "",
    `posts with a valid script   ${s.valid}/${s.posts}`,
    `repaired once               ${s.repaired}`,
    `notes per valid script      ${s.notes.toFixed(1)}`,
    `cost                        ${s.costUsd === null ? "unknown" : `$${s.costUsd.toFixed(2)}`}`,
    `time                        ${(s.ms / 1000).toFixed(1)} s`,
  ].join("\n");
}

/** Rough cost preview of a live run: one call per post, a repair in the worst case. */
export function estimateReelEval(posts: number): {
  typicalUsd: number | null;
  worstUsd: number | null;
} {
  const config = STAGE_CONFIG.REEL_DIRECTION;
  const one = computeCostUsd(config.model, { inputTokens: 4_500, outputTokens: 3_200 });
  if (one === null) return { typicalUsd: null, worstUsd: null };
  const round = (x: number) => Math.round(x * 100) / 100;
  return { typicalUsd: round(one * posts), worstUsd: round(one * posts * 2) };
}

/** The sheet the owner reads (V-29): hook options and the scenes of every script, in Markdown. */
export function reelReviewSheet(
  posts: readonly ReelPost[],
  results: readonly ReelEvalResult[],
): string {
  const out: string[] = [
    "# Reel scripts for review",
    "",
    "For every post rate 1–5: *claim fidelity* (nothing in the Reel that the carousel does not say), *hook quality* (would it stop you in the feed), *native voice*. Note the best hook option.",
    "",
  ];
  for (const result of results) {
    const post = posts.find((p) => p.key === result.key);
    out.push(`## ${result.key} · ${post?.input.market.code ?? ""}`, "");
    if (!result.script || !post) {
      out.push(`No valid script (${result.status}).`, "");
      for (const i of result.issues) out.push(`- ${i.code}: ${i.message}`);
      out.push("");
      continue;
    }
    out.push(
      `Carousel hook (${post.input.carousel.hookType}): ${post.input.carousel.hook}`,
      "",
      "| Option | Hook type | Card → rule card | Why |",
      "|---|---|---|---|",
      ...result.script.hookOptions.map(
        (h) =>
          `| ${h.id}${h.id === result.script?.chosenHookId ? " ✓" : ""} | ${h.hookType} | ${h.card} → ${h.ruleCard} | ${h.rationale} |`,
      ),
      "",
      `${result.script.scenes.length} scenes, ${result.seconds} s, flash opener ${result.script.flashOpener}.`,
      "",
      "| # | Role | Emotion | Beats | Card | Shot | Picture |",
      "|---|---|---|---|---|---|---|",
      ...result.script.scenes.map(
        (s) =>
          `| ${s.index + 1} | ${s.role} | ${s.emotion} | ${s.beats} | ${s.card} | ${s.shotPrompt} | ${s.sourcePictureId} |`,
      ),
      "",
    );
    if (result.issues.length > 0) {
      out.push(
        "Notes:",
        ...result.issues.map((i) => `- ${i.code} (${i.fieldPath ?? ""}): ${i.message}`),
        "",
      );
    }
  }
  return out.join("\n");
}
