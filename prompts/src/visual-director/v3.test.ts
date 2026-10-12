import { describe, expect, it } from "vitest";
import { promptRegistry, renderPrompt } from "../index";
import { FIXTURE_INPUT } from "./fixtures";
import v2 from "./v2";
import v3 from "./v3";

describe("visual-director@3", () => {
  it("is registered, with the defaults of v2", () => {
    expect(promptRegistry.get("visual-director", 3)).toBe(v3);
    expect(v3).toMatchObject({ key: "visual-director@3", stage: "VISUAL_DIRECTION" });
    expect(v3.defaults).toEqual(v2.defaults);
    expect(v3.hash).not.toBe(v2.hash);
  });

  it("renders the same user message as v2", () => {
    expect(renderPrompt(v3, FIXTURE_INPUT)).toEqual(renderPrompt(v2, FIXTURE_INPUT));
  });

  it("asks for cut-out macro photos on white with the empty side of each template", () => {
    const rules = v3.system[1]?.text ?? "";
    expect(rules).toContain("cut out on white");
    expect(rules).toContain(
      '"The left 40% of the frame, top to bottom, is completely empty pure white."',
    );
    expect(rules).toContain('Template C, slots "before" and "after"');
    expect(rules).toContain("gray stone surface, rustic wooden table");
    expect(rules).not.toContain("lots of whitespace");
    expect(rules).not.toContain("unless the slide needs a hand");
    expect(v3.system[0]?.text).toBe(v2.system[0]?.text);
  });
});
