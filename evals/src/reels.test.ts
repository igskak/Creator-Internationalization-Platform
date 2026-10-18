import { createFakeLLMProvider } from "@rc/lib/providers/llm";
import { promptRegistry } from "@rc/prompts";
import { CHOCOLATE_POST, REEL_POSTS } from "@rc/prompts/fixtures/reel-director";
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
    // The hook is held 2.5 s whatever the script says (the calm hook, 2026-10-18).
    expect(results.map((r) => r.seconds)).toEqual([14.5, 14.5, 14.5]);
    // Every script offers three different hook types.
    for (const r of results) expect(new Set(r.hookTypes).size).toBe(3);
    // The scripts of the eval set cover several hook types between them.
    expect(new Set(results.flatMap((r) => r.hookTypes)).size).toBeGreaterThanOrEqual(5);

    const summary = summarizeReelEval(results);
    expect(summary).toMatchObject({ posts: 3, valid: 3, repaired: 0, notes: 0 });
    expect(formatReelSummary(summary, "scripted")).toContain("posts with a valid script   3/3");
    expect(formatReelSummary(summary, "scripted")).toContain("hook shot names a motion    3/3");
  });

  it("runs reel-director@3 on the chocolate trap and reports where the hook starts", async () => {
    const results = await runReelEval([CHOCOLATE_POST], {
      llm: createFakeEvalModel(),
      prompt: promptRegistry.get("reel-director", 3),
    });
    expect(results[0]).toMatchObject({
      key: "chocolate-drop",
      valid: true,
      hookShotMoves: true,
      hookPictureMoves: true,
      hook: { pictureId: "p6" },
    });
    expect(results[0]?.hook?.picture).toContain("ribbon of melted chocolate falling");
    expect(reelReviewSheet([CHOCOLATE_POST], results)).toContain("picture moves: yes");
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
    expect(sheet).toContain("7 scenes, 14.5 s, flash opener OFF.");
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
