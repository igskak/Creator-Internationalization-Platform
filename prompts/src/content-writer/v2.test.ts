import { describe, expect, it } from "vitest";
import { promptRegistry, renderPrompt } from "../index";
import { FIXTURE_INPUT } from "./fixtures";
import v1 from "./v1";
import v2 from "./v2";

describe("content-writer@2", () => {
  it("is registered next to v1 with the same defaults", () => {
    expect(promptRegistry.get("content-writer", 2)).toBe(v2);
    expect(v2).toMatchObject({ key: "content-writer@2", stage: "CONTENT_WRITING" });
    expect(v2.defaults).toEqual(v1.defaults);
    expect(v2.hash).not.toBe(v1.hash);
  });

  it("renders the same user message as v1", () => {
    expect(renderPrompt(v2, FIXTURE_INPUT)).toEqual(renderPrompt(v1, FIXTURE_INPUT));
  });

  it("adds exactly the hook rule to the rules of v1", () => {
    const [, before] = v1.system;
    const [, after] = v2.system;
    const added = (after?.text ?? "").split("\n").filter((l) => !(before?.text ?? "").includes(l));
    expect(added).toHaveLength(1);
    expect(added[0]).toContain("must stop the scroll");
    expect(v2.system[0]?.text).toBe(v1.system[0]?.text);
  });
});
