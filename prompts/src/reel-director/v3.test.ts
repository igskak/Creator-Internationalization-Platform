import { describe, expect, it } from "vitest";
import { promptRegistry, renderPrompt, renderSnapshot } from "../index";
import { CHOCOLATE_POST, FIXTURE_INPUT_V2, REEL_EVAL_POSTS } from "./fixtures";
import v2, { reelDirectorV2OutputFor } from "./v2";
import prompt from "./v3";

const textOf = (input: unknown) =>
  renderPrompt(prompt, input)
    .map((p) => p.text)
    .join("\n");

describe("reel-director@3", () => {
  it("is registered with the stage, defaults and schemas of v2", () => {
    expect(promptRegistry.get("reel-director", 3)).toBe(prompt);
    expect(prompt).toMatchObject({
      key: "reel-director@3",
      stage: "REEL_DIRECTION",
      defaults: v2.defaults,
    });
    expect(prompt.system[1]?.cache).toBe(true);
    expect(prompt.hash).not.toBe(v2.hash);
  });

  it("renders as a stable snapshot (a change needs v4)", () => {
    expect(renderSnapshot(prompt, FIXTURE_INPUT_V2)).toMatchSnapshot();
  });

  it("renders the request exactly as v2 does", () => {
    for (const post of REEL_EVAL_POSTS) {
      expect(textOf(post.input)).toBe(
        renderPrompt(v2, post.input)
          .map((p) => p.text)
          .join("\n"),
      );
    }
    expect(prompt.system[0]?.text).toBe(v2.system[0]?.text);
  });

  it("adds the hook rules to the shots and asks for no flash opener, the rest is v2's", () => {
    const rules = prompt.system[1]?.text ?? "";
    const before = v2.system[1]?.text ?? "";
    expect(rules).toContain("The HOOK scene is the one shot a cold viewer sees");
    expect(rules).toContain("the most dynamic and appetizing shot of the whole Reel");
    expect(rules).toContain("Never start the hook from a near-still picture of ingredients");
    expect(rules).toContain("pour, stream, fall, sizzle, stir");
    expect(rules).toContain("Take it from any slide of the carousel");
    expect(rules).toContain('"flashOpener": OFF.');
    expect(rules).not.toContain("Use ON by default");
    // The hook rules sit in "# Shots", before "# Facts".
    expect(rules.indexOf("The HOOK scene is the one shot")).toBeGreaterThan(
      rules.indexOf("# Shots"),
    );
    expect(rules.indexOf("The HOOK scene is the one shot")).toBeLessThan(rules.indexOf("# Facts"));
    // Every other heading of v2 is there unchanged.
    for (const heading of [
      "# Story",
      "# Timing",
      "# Hooks",
      "# Cards",
      "# Facts",
      "# Post",
      "# Language and market",
      "# Output",
    ]) {
      const at = before.indexOf(heading);
      expect(at).toBeGreaterThan(-1);
      const block = before.slice(at, before.indexOf("\n# ", at + 1));
      if (heading === "# Story" || heading === "# Timing") {
        expect(rules).toContain(block.split("\n")[1] ?? "");
        continue;
      }
      expect(rules).toContain(block);
    }
  });

  it("parses the chocolate trap's answer and keeps the ribbon as the hook shot", () => {
    expect(
      reelDirectorV2OutputFor(CHOCOLATE_POST.input).safeParse(CHOCOLATE_POST.output).success,
    ).toBe(true);
    expect(CHOCOLATE_POST.output.scenes[0]?.sourcePictureId).toBe("p6");
  });
});
