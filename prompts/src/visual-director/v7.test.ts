import { describe, expect, it } from "vitest";
import { promptRegistry, renderPrompt } from "../index";
import { FIXTURE_INPUT } from "./fixtures";
import { ARRANGEMENTS, PLACEMENTS, VESSELS, VisualDirectorOutput } from "./schema";
import v6 from "./v6";
import v7 from "./v7";

describe("visual-director@7", () => {
  it("is the latest director, with the defaults, data rules and user message of v6", () => {
    expect(promptRegistry.latest("visual-director")).toBe(v7);
    expect(v7).toMatchObject({ key: "visual-director@7", stage: "VISUAL_DIRECTION" });
    expect(v7.defaults).toEqual(v6.defaults);
    expect(v7.hash).not.toBe(v6.hash);
    expect(renderPrompt(v7, FIXTURE_INPUT)).toEqual(renderPrompt(v6, FIXTURE_INPUT));
    expect(v7.system[0]?.text).toBe(v6.system[0]?.text);
  });

  it("names every arrangement, placement and vessel, and the new fields", () => {
    const rules = v7.system[1]?.text ?? "";
    for (const a of ARRANGEMENTS) expect(rules).toContain(`- ${a}:`);
    for (const p of PLACEMENTS) expect(rules).toContain(`- ${p}:`);
    for (const v of VESSELS) expect(rules).toContain(v);
    expect(rules).toContain('- "vessel" (GENERATE)');
    expect(rules).toContain('- "depicts" (GENERATE)');
  });

  it("asks for whole subjects, light vessels and two servings for a comparison", () => {
    const rules = v7.system[1]?.text ?? "";
    expect(rules).toContain("nothing is cut by the frame's edges");
    expect(rules).toContain("at most once in the carousel");
    expect(rules).toContain("Never one frame split in half.");
    expect(rules).toContain("never from a dark pot");
    // The v5 rule that made a dark pot the default contrast for pale food is gone.
    expect(rules).not.toContain("put it in or on one vessel of a strong colour");
    expect(rules).not.toContain("cropped by the right and bottom edges");
  });

  it("accepts a brief with vessel and depicts", () => {
    const parsed = VisualDirectorOutput.parse({
      concept: "c",
      visualStyle: "BRIGHT_STUDIO",
      differentiationFromSibling: "",
      slides: [
        {
          slideId: "s1",
          slot: "side",
          source: "GENERATE",
          prompt: "A spoon lifts fluffy rice from a white porcelain bowl.",
          composition: "The result of the method.",
          aspect: "4:5",
          shotType: "TECHNIQUE_IN_ACTION",
          arrangement: "TOOL_IN_ACTION",
          placement: "TOP_RIGHT",
          vessel: "WHITE_PORCELAIN",
          depicts: "rice stays separate",
          colorAccent: "",
        },
      ],
    });
    expect(parsed.slides[0]).toMatchObject({
      vessel: "WHITE_PORCELAIN",
      depicts: "rice stays separate",
    });
  });
});
