import { describe, expect, it } from "vitest";
import { type HashInput, reelInputHash } from "./hash";

const [first, second] = [
  { id: "s1", beats: 4, card: "Hot water on **bulgur?**", layout: "RIGHT" },
  { id: "s2", beats: 3, card: "Only if it's **fine.**", layout: "RIGHT" },
] as const;
const base: HashInput = {
  flashOpener: true,
  scenes: [first, second],
  shots: { s1: { sha256: "aa" }, s2: { sha256: "bb", trimStartSeconds: 0.5 } },
  audio: { kind: "PLACEHOLDER_BEAT", sha256: "cc" },
};

describe("reelInputHash", () => {
  it("is stable for the same input", () => {
    expect(reelInputHash(base)).toBe(reelInputHash(structuredClone(base)));
    expect(reelInputHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["a card", { ...base, scenes: [{ ...first, card: "Other" }, second] }],
    ["the beats", { ...base, scenes: [{ ...first, beats: 5 }, second] }],
    ["the layout", { ...base, scenes: [{ ...first, layout: "FULL" }, second] }],
    ["a shot", { ...base, shots: { ...base.shots, s1: { sha256: "zz" } } }],
    [
      "where a scene starts in its shot",
      { ...base, shots: { ...base.shots, s2: { sha256: "bb", trimStartSeconds: 1 } } },
    ],
    ["the flash opener", { ...base, flashOpener: false }],
    ["the audio", { ...base, audio: { kind: "PLACEHOLDER_BEAT", sha256: "dd" } }],
    ["no audio", { ...base, audio: undefined }],
  ] as [string, HashInput][])("changes with %s", (_name, changed) => {
    expect(reelInputHash(changed)).not.toBe(reelInputHash(base));
  });
});
