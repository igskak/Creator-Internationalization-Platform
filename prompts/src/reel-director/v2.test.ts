import { describe, expect, it } from "vitest";
import { promptRegistry, renderPrompt, renderSnapshot } from "../index";
import { FIXTURE_INPUT_V2, FIXTURE_OUTPUT_V2, REEL_POSTS } from "./fixtures";
import v1 from "./v1";
import prompt, { REEL_POST_LIMITS, ReelDirectorInputV2, reelDirectorV2OutputFor } from "./v2";

const textOf = (input: unknown) =>
  renderPrompt(prompt, input)
    .map((p) => p.text)
    .join("\n");

describe("reel-director@2", () => {
  it("is registered with the stage and defaults of v1", () => {
    expect(promptRegistry.get("reel-director", 2)).toBe(prompt);
    expect(prompt).toMatchObject({
      key: "reel-director@2",
      stage: "REEL_DIRECTION",
      defaults: v1.defaults,
    });
    expect(prompt.system[1]?.cache).toBe(true);
    expect(prompt.hash).not.toBe(v1.hash);
  });

  it("renders as a stable snapshot (a change needs v3)", () => {
    expect(renderSnapshot(prompt, FIXTURE_INPUT_V2)).toMatchSnapshot();
  });

  it("keeps v1's rules and adds the post, the flash default and the hook preference", () => {
    const rules = prompt.system[1]?.text ?? "";
    const before = v1.system[1]?.text ?? "";
    expect(rules).toContain("# Post");
    expect(rules.indexOf("# Post")).toBeLessThan(rules.indexOf("# Output"));
    expect(rules).toContain("Use ON by default");
    expect(rules).not.toContain("use OFF when the hook scene is already strong");
    expect(rules).toContain("a doubt about something they already do");
    expect(rules).toContain(`${REEL_POST_LIMITS.minHashtags} to ${REEL_POST_LIMITS.maxHashtags}`);
    expect(rules).toContain(`At most ${REEL_POST_LIMITS.maxCaptionChars} characters`);
    expect(rules).toContain("never mention swiping, slides, a carousel");
    // Everything v1 says about the story, shots and facts is still there.
    for (const heading of ["# Story", "# Timing", "# Hooks", "# Cards", "# Shots", "# Facts"]) {
      const at = before.indexOf(heading);
      const block = before.slice(at, before.indexOf("\n# ", at + 1));
      if (heading === "# Timing" || heading === "# Hooks") continue;
      expect(rules).toContain(block);
    }
    expect(prompt.system[0]?.text).toContain(
      "<post>, <cta_types>, <recent_cta_types>, <recent_hashtags>",
    );
  });

  it("renders the carousel's post and the recent asks and tags before the task", () => {
    const text = textOf(FIXTURE_INPUT_V2);
    expect(text).toContain('<post of="carousel">');
    expect(text).toContain("Guárdalo para tu próximo risotto.");
    expect(text).toContain('<cta type="SAVE">');
    expect(text).toContain('<term code="SHARE">');
    expect(text).toContain('<type code="SAVE" n="1">');
    expect(text).toContain("#trucosdecocina");
    expect(text.indexOf("<recent_hashtags>")).toBeLessThan(text.indexOf("<task>"));
    // The carousel section itself is v1's, without the caption in it.
    const v1Text = renderPrompt(v1, ReelDirectorInputV2.parse(FIXTURE_INPUT_V2))
      .map((p) => p.text)
      .join("\n");
    const carousel = v1Text.slice(v1Text.indexOf("<carousel"), v1Text.indexOf("</carousel>"));
    expect(text).toContain(carousel);
  });

  it("parses every synthetic answer and limits the ask to the given codes", () => {
    for (const post of REEL_POSTS) {
      expect(reelDirectorV2OutputFor(post.input).safeParse(post.output).success).toBe(true);
    }
    const locked = { ...FIXTURE_INPUT_V2, ctaTypes: [{ code: "COMMENT_KEYWORD", label: "Kw" }] };
    expect(reelDirectorV2OutputFor(locked).safeParse(FIXTURE_OUTPUT_V2).success).toBe(false);
  });
});
