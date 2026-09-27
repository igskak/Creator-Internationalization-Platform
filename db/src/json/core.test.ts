import { describe, expect, it } from "vitest";
import {
  ForbiddenPattern,
  ForbiddenPatternList,
  VisualHypothesis,
  VisualSystem,
  VocabularyEntry,
} from "./core";

const colors = {
  background: "#FFFFFF",
  surface: "#F4F1EC",
  text: "#1A1A1A",
  accent: "#C8553D",
  positive: "#2E7D32",
  negative: "#C62828",
};
const visualSystem = {
  colors,
  fonts: { display: "display-serif", body: "body-sans" },
  logo: { assetKey: "brand/logo.svg", minHeightPx: 48 },
  spacing: { safeMarginPx: 64 },
};

describe("VisualSystem", () => {
  it("accepts a full system and defaults themeVariants", () => {
    expect(VisualSystem.parse(visualSystem).themeVariants).toEqual({});
  });

  it("rejects bad colors, missing parts and bad sizes with field paths", () => {
    const result = VisualSystem.safeParse({
      ...visualSystem,
      colors: { ...colors, accent: "red" },
      logo: { assetKey: "brand/logo.svg", minHeightPx: 0 },
      fonts: undefined,
    });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((i) => i.path.join(".")).sort();
    expect(paths).toEqual(["colors.accent", "fonts", "logo.minHeightPx"]);
  });

  it("accepts partial color overrides in theme variants", () => {
    const parsed = VisualSystem.parse({
      ...visualSystem,
      themeVariants: { dark: { background: "#000000" } },
    });
    expect(parsed.themeVariants.dark).toEqual({ background: "#000000" });
    expect(
      VisualSystem.safeParse({ ...visualSystem, themeVariants: { dark: { background: "black" } } })
        .success,
    ).toBe(false);
  });
});

describe("VocabularyEntry", () => {
  it("requires concept and preferred term", () => {
    expect(VocabularyEntry.safeParse({ concept: "shrimp", preferred: "gamba" }).success).toBe(true);
    expect(VocabularyEntry.safeParse({ concept: "shrimp", preferred: "" }).success).toBe(false);
  });
});

describe("ForbiddenPattern", () => {
  it("accepts phrases and valid regexes", () => {
    expect(
      ForbiddenPattern.safeParse({ pattern: "delve", kind: "PHRASE", reason: "AI tell" }).success,
    ).toBe(true);
    expect(
      ForbiddenPattern.safeParse({ pattern: "\\bcamar[oó]n\\b", kind: "REGEX", reason: "LatAm" })
        .success,
    ).toBe(true);
  });

  it("rejects an invalid regex at pattern", () => {
    const result = ForbiddenPatternList.safeParse([
      { pattern: "(unclosed", kind: "REGEX", reason: "broken" },
    ]);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: [0, "pattern"], message: "Invalid regular expression" }),
    ]);
  });

  it("does not compile phrases, so special characters are fine", () => {
    expect(
      ForbiddenPattern.safeParse({ pattern: "(sic", kind: "PHRASE", reason: "x" }).success,
    ).toBe(true);
  });
});

describe("VisualHypothesis", () => {
  it("validates the status", () => {
    const base = { id: "h1", description: "Warm", visualStyle: "WARM_MEDITERRANEAN" };
    expect(VisualHypothesis.safeParse({ ...base, status: "TESTING" }).success).toBe(true);
    expect(VisualHypothesis.safeParse({ ...base, status: "MAYBE" }).success).toBe(false);
  });
});
