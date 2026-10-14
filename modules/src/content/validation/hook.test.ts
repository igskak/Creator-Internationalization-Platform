import type { Slide } from "@rc/db/json";
import { taxonomySeeds } from "@rc/db/seed";
import { HOOK_LIBRARY } from "@rc/prompts";
import { describe, expect, it } from "vitest";
import {
  type DraftContent,
  flagsForIssues,
  type ValidationContext,
  validateDraft,
  validateHookLine,
} from "./index";

// Synthetic content only.
const slide = (overrides: Partial<Slide> & { id: string; role: Slide["role"] }): Slide => ({
  index: 0,
  templateId: "B",
  slots: { body: "Rinse the rice until the water runs clear." },
  images: {},
  knowledgeIds: ["k1"],
  factual: true,
  ...overrides,
});

const slides = (hookHeadline = "Stop rinsing the rice"): Slide[] => [
  slide({
    id: "s1",
    role: "HOOK",
    templateId: "A",
    slots: { headline: hookHeadline },
    knowledgeIds: [],
    factual: false,
  }),
  slide({ id: "s2", role: "PROBLEM" }),
  slide({ id: "s3", role: "EXPLANATION" }),
  slide({ id: "s4", role: "STEP" }),
  slide({
    id: "s5",
    role: "CTA",
    templateId: "F",
    slots: { headline: "Save it" },
    knowledgeIds: [],
    factual: false,
  }),
];

const draft = (hook: string, hookHeadline = hook): DraftContent => ({
  hook,
  hookType: "MYTH_BUST",
  caption: "Rice is simpler than you think.",
  cta: { type: "SAVE", text: "Save it" },
  hashtags: ["#rice", "#cooking", "#kitchentips"],
  slides: slides(hookHeadline),
});

const context = (overrides: Partial<ValidationContext> = {}): ValidationContext => ({
  locale: "en",
  forbiddenPatterns: [],
  ideaKnowledgeIds: new Set(["k1"]),
  numericReference: {
    timings: [{ value: 10, valueMax: 15, unit: "min" }],
    temperatures: [{ value: 180, unit: "C" }],
    ingredients: [{ quantity: 200, unit: "g" }],
    texts: ["Use two parts water to 1:2 rice, 7 mistakes are common."],
    textLocale: "en",
  },
  ...overrides,
});

// The hook line and the HOOK slide usually say the same, so one problem is reported on both fields.
const codes = (d: DraftContent, c = context()) => [
  ...new Set(validateHookLine(d, c).map((i) => i.code)),
];

describe("the hook library and the taxonomy", () => {
  it("has an entry for every seeded hook type and for nothing else", () => {
    const seeded = taxonomySeeds.filter((t) => t.kind === "hook_type").map((t) => t.code);
    expect(Object.keys(HOOK_LIBRARY).sort()).toEqual([...seeded].sort());
  });
});

describe("validateHookLine: banned patterns", () => {
  it("passes a plain hook", () => {
    expect(codes(draft("Stop rinsing the rice"))).toEqual([]);
  });

  it.each([
    "I tested 100 ways to cook rice",
    "Guaranteed fluffy rice",
    "Nobody tells you this about rice",
    "Fluffy rice by tomorrow",
    "This will change everything",
  ])("blocks %s", (hook) => {
    const issues = validateHookLine(draft(hook), context());
    expect(issues.map((i) => i.code)).toContain("HOOK_BANNED_PATTERN");
    expect(issues.every((i) => i.severity === "BLOCKER")).toBe(true);
    expect(issues[0]?.fieldPath).toBe("hook");
  });

  it("checks the HOOK slide too, and not the other slides", () => {
    const d = draft("Stop rinsing the rice", "Guaranteed fluffy rice");
    const issues = validateHookLine(d, context());
    expect(issues.map((i) => i.fieldPath)).toEqual(["slides.s1.slots.headline"]);
    const body = draft("Stop rinsing the rice");
    body.slides = body.slides.map((s) =>
      s.id === "s2" ? { ...s, slots: { body: "Guaranteed to work." } } : s,
    );
    expect(codes(body)).toEqual([]);
  });

  it("reads the emphasis markers away", () => {
    expect(codes(draft("x", "Guaranteed **fluffy** rice"))).toEqual(["HOOK_BANNED_PATTERN"]);
    expect(codes(draft("x", "Nobody **tells** you this"))).toEqual(["HOOK_BANNED_PATTERN"]);
  });

  it("uses the Spanish list for es-ES and none for a language without a list", () => {
    expect(codes(draft("Lo que no te cuentan del arroz"), context({ locale: "es-ES" }))).toEqual([
      "HOOK_BANNED_PATTERN",
    ]);
    expect(codes(draft("Garantizado"), context({ locale: "ru" }))).toEqual([]);
    expect(codes(draft("Guaranteed"), context({ locale: "es-ES" }))).toEqual([]);
  });
});

describe("validateHookLine: numbers", () => {
  it("allows a number a card states, 1, and the count of body slides", () => {
    expect(codes(draft("7 mistakes ruin rice"))).toEqual([]); // in a card text
    expect(codes(draft("200 to fix"))).toEqual([]); // an ingredient quantity
    expect(codes(draft("1 rule for rice"))).toEqual([]);
    expect(codes(draft("3 ways to ruin rice"))).toEqual([]); // 3 body slides (s2, s3, s4)
  });

  it("blocks a number that is on no card and is not the point count", () => {
    const issues = validateHookLine(draft("5 ways to ruin rice"), context());
    expect(issues.map((i) => i.code)).toEqual([
      "HOOK_NUMBER_UNSUPPORTED",
      "HOOK_NUMBER_UNSUPPORTED",
    ]);
    expect(issues.map((i) => i.fieldPath)).toEqual(["hook", "slides.s1.slots.headline"]);
    expect(issues[0]?.message).toContain("5");
    expect(issues[0]?.message).toContain("(3)");
    expect(issues[0]?.severity).toBe("BLOCKER");
  });

  it("leaves numbers with a unit to numeric fidelity", () => {
    expect(codes(draft("Bake it 40 min"))).toEqual([]);
    const result = validateDraft(draft("Bake it 40 min"), context());
    expect(result.issues.map((i) => i.code)).toContain("NUMERIC_MISMATCH");
  });

  it("ignores decimals and ratios it cannot read as one number", () => {
    expect(codes(draft("Use 1.5 cups"))).toEqual([]);
  });
});

describe("hook issues in the flags", () => {
  it("raise UNSUPPORTED_CLAIM when left unresolved", () => {
    const issues = validateHookLine(draft("5 ways to ruin rice"), context());
    expect(flagsForIssues(issues)).toEqual(["UNSUPPORTED_CLAIM"]);
  });

  it("run as part of validateDraft", () => {
    const result = validateDraft(draft("Guaranteed fluffy rice"), context());
    expect(result.blocking.map((i) => i.code)).toContain("HOOK_BANNED_PATTERN");
  });
});
