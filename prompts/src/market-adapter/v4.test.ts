import { describe, expect, it } from "vitest";
import { promptRegistry, renderPrompt } from "../index";
import { FIXTURE_INPUT } from "./fixtures";
import v3 from "./v3";
import v4 from "./v4";

describe("market-adapter@4", () => {
  it("is the latest planner, with the input, output and message of v3", () => {
    expect(promptRegistry.latest("market-adapter")).toBe(v4);
    expect(v4).toMatchObject({ key: "market-adapter@4", stage: "MARKET_ADAPTATION" });
    expect(v4.defaults).toEqual(v3.defaults);
    expect(v4.hash).not.toBe(v3.hash);
    expect(v4.system[0]?.text).toBe(v3.system[0]?.text);
    expect(renderPrompt(v4, FIXTURE_INPUT)).toEqual(renderPrompt(v3, FIXTURE_INPUT));
  });

  it("adds the arc of a lesson before the structure rule and changes nothing else", () => {
    const before = (v3.system[1]?.text ?? "").split("\n");
    const after = (v4.system[1]?.text ?? "").split("\n");
    expect(after).toHaveLength(before.length + 1);
    const added = after.filter((line) => !before.includes(line));
    expect(added).toHaveLength(2);
    expect(added[0]).toContain("- Story: plan the carousel as a short lesson");
    expect(added[0]).toContain("the portion (FACT");
    expect(added[0]).toContain("the check (SUMMARY");
    expect(added[1]).toContain("within that arc");
  });
});
