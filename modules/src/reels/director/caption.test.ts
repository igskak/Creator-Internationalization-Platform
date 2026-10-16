import { describe, expect, it } from "vitest";
import { hookLine, reelCaption, swapHookLine } from "./caption";

// The Reel's caption is the hook line plus the director's caption (reel-director@2).

describe("the Reel caption", () => {
  const bulgur = { card: "Hot water on **bulgur?**", ruleCard: "Only if it's **fine.**" };
  const rule = { card: "One rule for **every** pot", ruleCard: "Oil, acid, herbs, zest" };

  it("writes the hook line from the two cards, without accents, closing an open first card", () => {
    expect(hookLine(bulgur)).toBe("Hot water on bulgur? Only if it's fine.");
    expect(hookLine(rule)).toBe("One rule for every pot. Oil, acid, herbs, zest");
    expect(hookLine({ card: "¿Lavas el **arroz?**", ruleCard: "" })).toBe("¿Lavas el arroz?");
  });

  it("puts the director's caption after a blank line", () => {
    expect(reelCaption(bulgur, "  Fine bulgur is already cooked.\n\nFollow for more. ")).toBe(
      "Hot water on bulgur? Only if it's fine.\n\nFine bulgur is already cooked.\n\nFollow for more.",
    );
  });

  it("swaps the first line for another hook's, and leaves a rewritten first line alone", () => {
    const caption = reelCaption(bulgur, "Body.\n\nAsk.");
    expect(swapHookLine(caption, bulgur, rule)).toBe(
      "One rule for every pot. Oil, acid, herbs, zest\n\nBody.\n\nAsk.",
    );
    expect(swapHookLine("My own line.\n\nBody.", bulgur, rule)).toBeNull();
  });
});
