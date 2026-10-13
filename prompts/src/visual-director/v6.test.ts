import { describe, expect, it } from "vitest";
import { promptRegistry, renderPrompt } from "../index";
import { FIXTURE_INPUT } from "./fixtures";
import { ARRANGEMENTS, PLACEMENTS } from "./schema";
import v5 from "./v5";
import v6 from "./v6";

describe("visual-director@6", () => {
  it("is the latest director, with the defaults and the user message of v5", () => {
    expect(promptRegistry.latest("visual-director")).toBe(v6);
    expect(v6).toMatchObject({ key: "visual-director@6", stage: "VISUAL_DIRECTION" });
    expect(v6.defaults).toEqual(v5.defaults);
    expect(v6.hash).not.toBe(v5.hash);
    expect(renderPrompt(v6, FIXTURE_INPUT)).toEqual(renderPrompt(v5, FIXTURE_INPUT));
    expect(v6.system[0]?.text).toBe(v5.system[0]?.text);
  });

  it("describes every placement and arrangement, before colour, and keeps the v5 rules", () => {
    const rules = v6.system[1]?.text ?? "";
    for (const p of PLACEMENTS) expect(rules).toContain(`- ${p}:`);
    for (const a of ARRANGEMENTS) expect(rules).toContain(a);
    expect(rules).toContain("Two inner slides in a row never share a placement.");
    expect(rules).toContain("at most about 140 characters besides the headline");
    expect(rules.indexOf("# Placement and arrangement")).toBeLessThan(
      rules.indexOf("# Colour and contrast"),
    );
    expect(rules).toContain('- "placement" (GENERATE, templates B, D, E and F only)');
    expect(rules).toContain("# Visible action");
  });
});
