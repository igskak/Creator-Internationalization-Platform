import { describe, expect, it } from "vitest";
import { promptRegistry, renderPrompt } from "../index";
import { FIXTURE_INPUT } from "./fixtures";
import v2 from "./v2";
import v3 from "./v3";

const textOf = (prompt: typeof v3, input: unknown) =>
  renderPrompt(prompt, input)
    .map((p) => p.text)
    .join("\n");

describe("idea-generator@3", () => {
  it("is the latest idea generator, with the defaults, input and output of v2", () => {
    expect(promptRegistry.latest("idea-generator")).toBe(v3);
    expect(v3).toMatchObject({ key: "idea-generator@3", stage: "IDEA_GENERATION" });
    expect(v3.defaults).toEqual(v2.defaults);
    expect(v3.input).toBe(v2.input);
    expect(v3.output).toBe(v2.output);
    expect(v3.hash).not.toBe(v2.hash);
    expect(v3.system[0]?.text).toBe(v2.system[0]?.text);
  });

  it("adds the performance memory rules before the output section and changes nothing else", () => {
    const rules = v3.system[1]?.text ?? "";
    expect(rules).toContain("# Performance memory");
    expect(rules.indexOf("# Performance memory")).toBeLessThan(rules.indexOf("# Output"));
    expect(rules).toContain('"overusedThemes"');
    expect(rules).toContain('"untestedHypotheses"');
    expect(rules).toContain("never claim a pattern the memory does not list");
    expect(rules.replace(/\n\n# Performance memory[\s\S]*?(?=\n\n# Output)/u, "")).toBe(
      v2.system[1]?.text,
    );
  });

  it("renders the message as v2 does, with the memory when it is given", () => {
    const withMemory = {
      ...FIXTURE_INPUT,
      performanceMemory: '{"marketCode":"ALL","topPatterns":[]}',
    };
    expect(textOf(v3, withMemory)).toBe(textOf(v2, withMemory));
    expect(textOf(v3, withMemory)).toContain("<performance_memory>");
  });
});
