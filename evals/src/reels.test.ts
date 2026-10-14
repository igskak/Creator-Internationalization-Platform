import { createFakeLLMProvider } from "@rc/lib/providers/llm";
import { REEL_POSTS } from "@rc/prompts/fixtures/reel-director";
import { describe, expect, it } from "vitest";
import { createFakeEvalModel } from "./fake-model";
import {
  estimateReelEval,
  formatReelSummary,
  reelReviewSheet,
  runReelEval,
  summarizeReelEval,
} from "./reels";

// The Reel director eval (M8-03): a whole run with the fake model on the three synthetic posts.
// Nothing here calls a paid API.

const at = <T>(items: readonly T[], i: number): T => {
  const item = items[i];
  if (item === undefined) throw new Error(`No item at ${i}.`);
  return item;
};

describe("the Reel eval with the fake model", () => {
  it("runs the three synthetic posts to valid scripts", async () => {
    const results = await runReelEval(REEL_POSTS, { llm: createFakeEvalModel() });
    expect(results.map((r) => [r.key, r.status])).toEqual([
      ["risotto-rice", "SUCCEEDED"],
      ["bulgur-hot-water", "SUCCEEDED"],
      ["pasta-oil", "SUCCEEDED"],
    ]);
    expect(results.every((r) => r.valid && r.issues.length === 0)).toBe(true);
    expect(results.map((r) => r.seconds)).toEqual([14, 14, 14]);
    // Every script offers three different hook types.
    for (const r of results) expect(new Set(r.hookTypes).size).toBe(3);
    // The scripts of the eval set cover several hook types between them.
    expect(new Set(results.flatMap((r) => r.hookTypes)).size).toBeGreaterThanOrEqual(5);

    const summary = summarizeReelEval(results);
    expect(summary).toMatchObject({ posts: 3, valid: 3, repaired: 0, notes: 0 });
    expect(formatReelSummary(summary, "scripted")).toContain("posts with a valid script   3/3");
  });

  it("reports a post whose script stays invalid after the repair", async () => {
    const [post] = REEL_POSTS;
    if (!post) throw new Error("missing post");
    const broken = structuredClone(post.output);
    at(broken.scenes, 3).card = "uno dos tres cuatro cinco seis siete";
    const llm = createFakeLLMProvider({ handler: () => broken });
    const results = await runReelEval([post], { llm });
    expect(results[0]).toMatchObject({ valid: false, script: null, status: "INVALID_OUTPUT" });
    expect(results[0]?.issues.map((i) => i.code)).toContain("REEL_CARD_WORDS");
    expect(summarizeReelEval(results)).toMatchObject({ valid: 0 });
    expect(reelReviewSheet([post], results)).toContain("No valid script (INVALID_OUTPUT).");
  });

  it("writes a review sheet with the hook options and the scenes", async () => {
    const results = await runReelEval(REEL_POSTS.slice(0, 1), { llm: createFakeEvalModel() });
    const sheet = reelReviewSheet(REEL_POSTS, results);
    expect(sheet).toContain("## risotto-rice · es-ES");
    expect(sheet).toContain("| h1 ✓ | MISTAKE_CALLOUT |");
    expect(sheet).toContain("7 scenes, 14 s, flash opener ON.");
    expect(sheet).toContain("| 7 | CTA | SAVE_IT | 4 |");
    expect(sheet).toContain("claim fidelity");
  });

  it("estimates a live run from typical token counts", () => {
    const e = estimateReelEval(3);
    expect(e.typicalUsd).toBeGreaterThan(0.1);
    expect(e.typicalUsd).toBeLessThan(1);
    expect(e.worstUsd).toBeCloseTo((e.typicalUsd ?? 0) * 2, 1);
  });
});
