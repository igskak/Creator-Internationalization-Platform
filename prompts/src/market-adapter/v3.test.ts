import { describe, expect, it } from "vitest";
import { renderPrompt } from "../index";
import { FIXTURE_INPUT } from "./fixtures";
import v2 from "./v2";
import v3 from "./v3";

const textOf = (prompt: typeof v3, input: unknown) =>
  renderPrompt(prompt, input)
    .map((p) => p.text)
    .join("\n");

describe("market-adapter@3", () => {
  it("keeps the stage and defaults of v2", () => {
    expect(v3).toMatchObject({ key: "market-adapter@3", stage: "MARKET_ADAPTATION" });
    expect(v3.defaults).toEqual(v2.defaults);
    expect(v3.hash).not.toBe(v2.hash);
    expect(v3.system[0]?.text).toBe(v2.system[0]?.text);
  });

  it("replaces only the hookType rule", () => {
    const before = (v2.system[1]?.text ?? "").split("\n");
    const after = (v3.system[1]?.text ?? "").split("\n");
    expect(after).toHaveLength(before.length);
    const changed = after.filter((line, i) => line !== before[i]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain('"hookType"');
    expect(changed[0]).toContain("pattern the cards can back");
    expect(changed[0]).toContain("different hook type from every sibling plan");
  });

  it("lists the patterns and angles with each hook type, and nothing else changes", () => {
    const withLibrary = textOf(v3, FIXTURE_INPUT);
    expect(withLibrary).toContain(
      '<term code="MYTH_BUST">\nMyth bust — patterns: quote a popular belief',
    );
    expect(withLibrary).toContain("Fits angles: MYTH_VS_FACT");
    const withoutHookTypes = (t: string) => t.replace(/<hook_types>[\s\S]*?<\/hook_types>/u, "");
    expect(withoutHookTypes(withLibrary)).toBe(withoutHookTypes(textOf(v2, FIXTURE_INPUT)));
  });

  it("keeps a description the taxonomy already has", () => {
    const input = {
      ...FIXTURE_INPUT,
      taxonomy: {
        ...FIXTURE_INPUT.taxonomy,
        hookTypes: [{ code: "MYTH_BUST", label: "Myth bust", description: "Own text." }],
      },
    };
    const text = textOf(v3, input);
    expect(text).toContain("\nMyth bust — Own text.\n");
    expect(text).not.toContain("patterns:");
  });

  it("leaves a type without a library entry as it was", () => {
    const input = {
      ...FIXTURE_INPUT,
      taxonomy: {
        ...FIXTURE_INPUT.taxonomy,
        hookTypes: [{ code: "CUSTOM_TYPE", label: "Custom" }],
      },
    };
    expect(textOf(v3, input)).toContain('<term code="CUSTOM_TYPE">\nCustom\n</term>');
  });
});
