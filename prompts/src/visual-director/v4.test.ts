import { describe, expect, it } from "vitest";
import { promptRegistry, renderPrompt } from "../index";
import { FIXTURE_INPUT } from "./fixtures";
import { SHOT_TYPES } from "./schema";
import v1 from "./v1";
import v3 from "./v3";
import v4 from "./v4";

const textOf = (input = FIXTURE_INPUT) =>
  renderPrompt(v4, input)
    .map((c) => c.text)
    .join("\n");

describe("visual-director@4", () => {
  it("is the latest director, with the defaults of v3", () => {
    expect(promptRegistry.latest("visual-director")).toBe(v4);
    expect(v4).toMatchObject({ key: "visual-director@4", stage: "VISUAL_DIRECTION" });
    expect(v4.defaults).toEqual(v3.defaults);
    expect(v4.hash).not.toBe(v3.hash);
  });

  it("renders the recipe of the cards between the slides and the library", () => {
    const text = textOf();
    expect(text).toContain('<card id="k1" title="Rinse rice before cooking">');
    expect(text).toContain('<step n="1">\nPut the rice in a fine-mesh strainer.\n</step>');
    expect(text).toContain("<ingredient>\n200 g long-grain rice\n</ingredient>");
    expect(text.indexOf("<slides>")).toBeLessThan(text.indexOf("<recipe>"));
    expect(text.indexOf("<recipe>")).toBeLessThan(text.indexOf("<library>"));
    expect(textOf({ ...FIXTURE_INPUT, recipe: [] })).toContain("<recipe>");
  });

  it("names the recipe as data and describes every shot type of the schema", () => {
    expect(v4.system[0]?.text).toContain("<slides>, <recipe>, <library>");
    const rules = v4.system[1]?.text ?? "";
    for (const shot of SHOT_TYPES) expect(rules).toContain(`- ${shot}:`);
    expect(rules).toContain("two slides in a row never have the same shotType");
    expect(rules).toContain("the system adds them");
    expect(rules).not.toContain("# Composition by slot");
  });

  it("leaves the older versions' messages as they were", () => {
    const withoutRecipe = { ...FIXTURE_INPUT, recipe: [] };
    expect(renderPrompt(v3, FIXTURE_INPUT)).toEqual(renderPrompt(v3, withoutRecipe));
    expect(renderPrompt(v1, FIXTURE_INPUT)).toEqual(renderPrompt(v1, withoutRecipe));
  });
});
