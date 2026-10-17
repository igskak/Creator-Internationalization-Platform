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
    expect(added).toHaveLength(3);
    // D4: without an offer the call is "send it on and follow".
    expect(added.some((l) => l.includes("Without an offer use SHARE"))).toBe(true);
    const story = added.find((l) => l.startsWith("- Story:")) ?? "";
    expect(story).toContain("plan the carousel as a short lesson");
    expect(story).toContain("the portion (FACT");
    expect(story).toContain("the check (SUMMARY");
    expect(added.some((l) => l.includes("within that arc"))).toBe(true);
  });
});
