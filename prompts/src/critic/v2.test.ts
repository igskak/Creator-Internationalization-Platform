import { describe, expect, it } from "vitest";
import { promptRegistry, renderPrompt } from "../index";
import { FIXTURE_INPUT, FIXTURE_OUTPUT } from "./fixtures";
import { criticOutputV2For } from "./schema";
import v1 from "./v1";
import v2 from "./v2";

const rules = (p: { system: readonly { text: string }[] }) =>
  p.system.map((b) => b.text).join("\n");

describe("critic@2", () => {
  it("is registered next to v1 and keeps its stage, defaults and cache hints", () => {
    expect(promptRegistry.get("critic", 2)).toBe(v2);
    expect(v2).toMatchObject({ key: "critic@2", stage: "CRITIC", defaults: v1.defaults });
    expect(v2.hash).not.toBe(v1.hash);
    expect(v2.system.map((b) => b.cache)).toEqual([false, true]);
  });

  it("renders the same user message as v1", () => {
    expect(renderPrompt(v2, FIXTURE_INPUT)).toEqual(renderPrompt(v1, FIXTURE_INPUT));
  });

  it("adds the hook check, its scale and the HOOK category, and keeps every v1 rule", () => {
    const text = rules(v2);
    expect(text).toContain("**Hook.**");
    expect(text).toContain('Score it on its own as "hook"');
    expect(text).toContain("2 is a general statement or a title");
    expect(text).toContain('"HOOK"');
    for (const line of rules(v1)
      .split("\n")
      .filter((l) => l.startsWith("- **")))
      expect(text).toContain(line);
    expect(rules(v1)).not.toContain("Hook.");
  });

  it("needs the hook score and accepts the HOOK category", () => {
    const schema = criticOutputV2For(FIXTURE_INPUT);
    const v2Output = FIXTURE_OUTPUT;
    const { hook: _hook, ...withoutHook } = FIXTURE_OUTPUT.scores;
    expect(schema.safeParse(v2Output).success).toBe(true);
    expect(schema.safeParse({ ...v2Output, scores: withoutHook }).success).toBe(false);
    const hookIssue = {
      severity: "MAJOR",
      category: "HOOK",
      fieldPath: "hook",
      explanation: "A general statement.",
      suggestedFix: "Name the mistake.",
    };
    expect(schema.safeParse({ ...v2Output, issues: [hookIssue] }).success).toBe(true);
  });
});
