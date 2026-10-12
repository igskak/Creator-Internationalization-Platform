import { describe, expect, it } from "vitest";
import { promptRegistry, renderPrompt } from "../index";
import { FIXTURE_INPUT } from "./fixtures";
import v3 from "./v3";
import v4 from "./v4";

describe("content-writer@4", () => {
  it("is the latest writer, with the defaults of v3", () => {
    expect(promptRegistry.latest("content-writer")).toBe(v4);
    expect(v4).toMatchObject({ key: "content-writer@4", stage: "CONTENT_WRITING" });
    expect(v4.defaults).toEqual(v3.defaults);
    expect(v4.hash).not.toBe(v3.hash);
  });

  it("renders the same user message as v3", () => {
    expect(renderPrompt(v4, FIXTURE_INPUT)).toEqual(renderPrompt(v3, FIXTURE_INPUT));
  });

  it("adds exactly the emphasis rule to the rules of v3", () => {
    const [, before] = v3.system;
    const [, after] = v4.system;
    const added = (after?.text ?? "").split("\n").filter((l) => !(before?.text ?? "").includes(l));
    expect(added).toHaveLength(1);
    expect(added[0]).toContain("double asterisks");
    expect(added[0]).toContain('do not count towards "max_chars"');
    expect(v4.system[0]?.text).toBe(v3.system[0]?.text);
  });
});
