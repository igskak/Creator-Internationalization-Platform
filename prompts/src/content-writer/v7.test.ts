import { describe, expect, it } from "vitest";
import { promptRegistry, renderPrompt } from "../index";
import { FIXTURE_INPUT } from "./fixtures";
import v5 from "./v5";
import v7 from "./v7";

describe("content-writer@7", () => {
  it("is the latest writer, built on v5 (no learning), with its input, output and message", () => {
    expect(promptRegistry.latest("content-writer")).toBe(v7);
    expect(v7).toMatchObject({ key: "content-writer@7", stage: "CONTENT_WRITING" });
    expect(v7.defaults).toEqual(v5.defaults);
    expect(v7.output).toBe(v5.output);
    expect(v7.input).toBe(v5.input);
    expect(v7.hash).not.toBe(v5.hash);
    expect(v7.system[0]?.text).toBe(v5.system[0]?.text);
    expect(v7.system[0]?.text).not.toContain("<learning>");
    expect(renderPrompt(v7, FIXTURE_INPUT)).toEqual(renderPrompt(v5, FIXTURE_INPUT));
  });

  it("asks for ladder bodies with numbers, no filler, lead and closer, and the full method in the caption", () => {
    const rules = v7.system[1]?.text ?? "";
    expect(rules).not.toContain("Slide text is short and plain");
    expect(rules).toContain("Write body and text slots as a ladder");
    expect(rules).toContain("about 55 to 95 % of its max_chars");
    expect(rules).toContain("a cue the reader can see or hear");
    expect(rules).toContain('"trust the process"');
    expect(rules).toContain('"lead" is the quieter first half of a headline');
    expect(rules).toContain('"closer" is a bold last line under the body');
    expect(rules).toContain("on at most half of the slides wrap");
    expect(rules).toContain("The HOOK slide pairs the hook with one to three short lines");
    expect(rules).toContain("sign-off line");
    expect(rules).toContain('a line that starts with "Important:"');
    expect(rules).toContain("900 to 2200 characters");
    // The rules of v5 that stay: closed book, hook limits, CTA keyword.
    expect(rules).toContain("Closed book.");
    expect(rules).toContain("never use: an invented personal experience");
  });
});
