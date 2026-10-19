import { describe, expect, it } from "vitest";
import { promptRegistry, renderPrompt, renderSnapshot } from "../index";
import { FIXTURE_INPUT_V2, REEL_POSTS_V4 } from "./fixtures";
import v2 from "./v2";
import prompt, { REEL_LIMITS_V4, reelDirectorV4OutputFor } from "./v4";

const textOf = (input: unknown) =>
  renderPrompt(prompt, input)
    .map((p) => p.text)
    .join("\n");

describe("reel-director@4", () => {
  it("is registered with the stage, defaults and input of v2", () => {
    expect(promptRegistry.get("reel-director", 4)).toBe(prompt);
    expect(prompt).toMatchObject({
      key: "reel-director@4",
      stage: "REEL_DIRECTION",
      defaults: v2.defaults,
    });
    expect(prompt.system[1]?.cache).toBe(true);
    expect(prompt.system[0]?.text).toBe(v2.system[0]?.text);
  });

  it("renders as a stable snapshot (a change needs v5)", () => {
    expect(renderSnapshot(prompt, FIXTURE_INPUT_V2)).toMatchSnapshot();
  });

  it("renders the request exactly as v2 does", () => {
    for (const post of REEL_POSTS_V4) {
      expect(textOf(post.input)).toBe(
        renderPrompt(v2, post.input)
          .map((p) => p.text)
          .join("\n"),
      );
    }
  });

  it("asks for the owner's format: calm shots, a line of use, a summary, pictures in the account's look", () => {
    const rules = prompt.system[1]?.text ?? "";
    expect(rules).toContain(
      `${REEL_LIMITS_V4.minScenes} to ${REEL_LIMITS_V4.maxScenes} calm shots`,
    );
    expect(rules).toContain("so a shot lasts 3 to 3.5 seconds");
    expect(rules).toContain('"line" is one short sentence of use under the card');
    expect(rules).toContain("The HOOK scene's line is empty");
    expect(rules).toContain("its line states the whole rule in one sentence");
    expect(rules).toContain("a problem they recognise from their own kitchen");
    expect(rules).toContain('Never a vague hook ("Something wrong with your rice?")');
    expect(rules).toContain('"framePrompt" describes that picture in English');
    expect(rules).toContain("Pale or white food");
    expect(rules).toContain("sits in dark cookware");
    expect(rules).toContain('"layout" is FULL');
    expect(rules).toContain("then the sound it makes");
    expect(rules).toContain('"flashOpener": OFF.');
    expect(rules).toContain('Leave every "framePrompt" empty');
    // The post, the hook types and the facts are v2's, with the lines added to the number rule.
    for (const heading of ["# Hooks", "# Facts", "# Post", "# Output"]) {
      expect(rules).toContain(heading);
    }
    expect(rules).toContain("A number or an amount in a card or a line must appear on a slide");
    expect(rules).not.toContain("Use ON by default");
  });

  it("parses the four v4 answers with the schema of their call", () => {
    for (const post of REEL_POSTS_V4) {
      expect(reelDirectorV4OutputFor(post.input).safeParse(post.output).success).toBe(true);
    }
    const missingLine = structuredClone(REEL_POSTS_V4[0]?.output);
    if (missingLine?.scenes[1]) {
      delete (missingLine.scenes[1] as { line?: string }).line;
    }
    expect(reelDirectorV4OutputFor(FIXTURE_INPUT_V2).safeParse(missingLine).success).toBe(false);
  });
});
