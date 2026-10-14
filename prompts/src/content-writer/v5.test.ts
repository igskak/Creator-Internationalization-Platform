import { describe, expect, it } from "vitest";
import { promptRegistry, renderPrompt } from "../index";
import { FIXTURE_INPUT } from "./fixtures";
import v4 from "./v4";
import v5 from "./v5";

const textOf = (prompt: typeof v5, input: unknown) =>
  renderPrompt(prompt, input)
    .map((p) => p.text)
    .join("\n");

describe("content-writer@5", () => {
  it("is the latest writer, with the defaults of v4", () => {
    expect(promptRegistry.latest("content-writer")).toBe(v5);
    expect(v5).toMatchObject({ key: "content-writer@5", stage: "CONTENT_WRITING" });
    expect(v5.defaults).toEqual(v4.defaults);
    expect(v5.hash).not.toBe(v4.hash);
    expect(v5.system[0]?.text).toBe(v4.system[0]?.text);
  });

  it("adds exactly the two hook rules to the rules of v4", () => {
    const before = v4.system[1]?.text ?? "";
    const added = (v5.system[1]?.text ?? "").split("\n").filter((l) => !before.includes(l));
    expect(added).toHaveLength(2);
    expect(added[0]).toContain("never a copy of an example");
    expect(added[1]).toContain("invented personal experience");
    expect(added[1]).toContain("conspiracy framing");
  });

  it("gives the patterns and the market's examples for the planned hook type only", () => {
    const text = textOf(v5, FIXTURE_INPUT);
    expect(text).toContain(
      '<term code="MISTAKE_CALLOUT">\nMistake callout — patterns: name the number one mistake',
    );
    expect(text).toContain("Shape only, never copy:");
    // The fixture market is Spanish: its examples are in Spanish.
    expect(text).toContain("Ese es el error.");
    expect(text).toContain('<term code="MYTH_BUST">\nMyth bust\n</term>');
    expect(text).toContain('<term code="CURIOSITY_GAP">\nCuriosity gap\n</term>');
  });

  it("renders the rest of the message as v4 does", () => {
    const strip = (t: string) => t.replace(/<hook_types>[\s\S]*?<\/hook_types>/u, "");
    expect(strip(textOf(v5, FIXTURE_INPUT))).toBe(strip(textOf(v4, FIXTURE_INPUT)));
  });

  it("gives no examples for a language the library does not cover", () => {
    const input = {
      ...FIXTURE_INPUT,
      market: { ...FIXTURE_INPUT.market, language: "ru" },
    };
    const text = textOf(v5, input);
    expect(text).toContain("Mistake callout — patterns:");
    expect(text).not.toContain("Shape only");
  });
});
