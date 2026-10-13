import { describe, expect, it } from "vitest";
import { promptRegistry, renderPrompt } from "../index";
import { FIXTURE_INPUT } from "./fixtures";
import v4 from "./v4";
import v5 from "./v5";

describe("visual-director@5", () => {
  it("is the latest director, with the defaults and the user message of v4", () => {
    expect(promptRegistry.latest("visual-director")).toBe(v5);
    expect(v5).toMatchObject({ key: "visual-director@5", stage: "VISUAL_DIRECTION" });
    expect(v5.defaults).toEqual(v4.defaults);
    expect(v5.hash).not.toBe(v4.hash);
    expect(renderPrompt(v5, FIXTURE_INPUT)).toEqual(renderPrompt(v4, FIXTURE_INPUT));
    expect(v5.system[0]?.text).toBe(v4.system[0]?.text);
  });

  it("asks for colour, contrast for pale food and a visible action, before the recipe", () => {
    const rules = v5.system[1]?.text ?? "";
    expect(rules).toContain("# Colour and contrast");
    expect(rules).toContain("At least half of the generated pictures carry a clear colour accent");
    expect(rules).toContain("Only on the cover and on FINISHED_DISH shots");
    expect(rules).toContain("Pale food (rice, quinoa, pasta, oats, dough)");
    expect(rules).toContain("# Visible action");
    expect(rules).toContain("never make them the point of a picture");
    expect(rules.indexOf("# Visible action")).toBeLessThan(rules.indexOf("# The recipe"));
    expect(rules).toContain('- "colorAccent" (GENERATE)');
    expect(rules).not.toContain("One or two natural ingredients of the recipe may add colour");
  });
});
