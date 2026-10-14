import { describe, expect, it } from "vitest";
import { CONTENT_INTRO, INTROS, independentVersion } from "./independent";
import { type AnyPrompt, promptRegistry } from "./index";

// The versions made by independentVersion, one per prompt; later versions build on them.
const INDEPENDENT: [id: string, version: number, intro: string][] = [
  ["content-writer", 3, CONTENT_INTRO],
  ["critic", 3, CONTENT_INTRO],
  ["idea-generator", 2, CONTENT_INTRO],
  ["market-adapter", 2, CONTENT_INTRO],
  ["visual-director", 2, CONTENT_INTRO],
  ["visual-qa", 2, CONTENT_INTRO],
  ["knowledge-extractor", 2, INTROS.knowledgeBase.to],
  ["knowledge-gloss", 2, INTROS.knowledgeBase.to],
  ["page-transcriber", 2, INTROS.knowledgeBase.to],
  ["post-annotator", 2, INTROS.contentTool.to],
  ["eval-judge", 2, INTROS.judge.to],
];

// Prompts that were written after the decision and never had a brand name.
const WRITTEN_INDEPENDENT: [id: string, version: number, intro: string][] = [
  ["field-regenerator", 1, CONTENT_INTRO],
  ["reel-director", 1, CONTENT_INTRO],
];

/** The first system block after its opening sentence(s). */
const tail = (prompt: AnyPrompt, intro: RegExp | string) =>
  (prompt.system[0]?.text ?? "").replace(intro, "");

describe("independent prompt versions", () => {
  it.each(INDEPENDENT)("%s@%i changes only the opening of the data rules", (id, version, to) => {
    const next = promptRegistry.get(id, version);
    const previous = promptRegistry.get(id, version - 1);
    expect(next.system[0]?.text.startsWith(to)).toBe(true);
    // A later version keeps the neutral opening and names no brand either.
    const latest = promptRegistry.latest(id);
    expect(latest.version).toBeGreaterThanOrEqual(version);
    expect(latest.system[0]?.text.startsWith(to)).toBe(true);
    expect(latest.system.map((b) => b.text).join("\n")).not.toMatch(/Reg\.?Chef/i);
    const from = Object.values(INTROS).find((i) => i.to === to)?.from ?? /^/u;
    expect(tail(next, to)).toBe(tail(previous, from));
    expect(next.system.slice(1)).toEqual(previous.system.slice(1));
    expect(next).toMatchObject({
      stage: previous.stage,
      defaults: previous.defaults,
      render: previous.render,
      renderTemplate: previous.renderTemplate,
    });
    expect(next.hash).not.toBe(previous.hash);
  });

  it("covers every prompt id", () => {
    const ids = new Set(promptRegistry.list().map((p) => p.id));
    expect(
      [...INDEPENDENT.map(([id]) => id), ...WRITTEN_INDEPENDENT.map(([id]) => id)].sort(),
    ).toEqual([...ids].sort());
  });

  it.each(WRITTEN_INDEPENDENT)("%s@%i was written without a brand name", (id, version, to) => {
    const prompt = promptRegistry.get(id, version);
    expect(promptRegistry.latest(id)).toBe(prompt);
    expect(prompt.system[0]?.text.startsWith(to)).toBe(true);
    expect(prompt.system.map((b) => b.text).join("\n")).not.toMatch(/Reg\.?Chef/i);
  });

  it("refuses a released prompt whose opening has moved", () => {
    const previous = promptRegistry.get("critic", 1);
    expect(() => independentVersion(previous, INTROS.judge)).toThrow("critic@1 has changed shape.");
  });
});
