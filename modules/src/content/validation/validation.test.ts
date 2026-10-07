import { SLIDE_ROLES as DB_ROLES, TEMPLATE_IDS as DB_TEMPLATES, type Slide } from "@rc/db/json";
import { SLIDE_ROLES, TEMPLATE_IDS } from "@rc/templates";
import { describe, expect, it } from "vitest";
import {
  type DraftContent,
  flagsForIssues,
  isBlocking,
  splitIssues,
  type ValidationContext,
  type ValidationIssue,
  validateCitations,
  validateDraft,
  validateForbiddenPatterns,
  validateNumericFidelity,
  validateSlots,
  validateStructure,
  validateTextRules,
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

const validSlides = (): Slide[] => [
  slide({
    id: "s1",
    role: "HOOK",
    templateId: "A",
    slots: { headline: "Stop rinsing the rice" },
    images: { hero: {} },
  }),
  slide({ id: "s2", role: "PROBLEM" }),
  slide({
    id: "s3",
    role: "EXPLANATION",
    slots: { body: "Starch makes it creamy. Bake 10 min at 180 °C." },
  }),
  slide({ id: "s4", role: "STEP" }),
  slide({
    id: "s5",
    role: "CTA",
    templateId: "F",
    slots: { headline: "Get the guide", body: "Comment RICE and we send it." },
    knowledgeIds: [],
    factual: false,
  }),
];

const draft = (overrides: Partial<DraftContent> = {}): DraftContent => ({
  hook: "Stop rinsing the rice",
  hookType: "MYTH_BUST",
  caption: "Rice is simpler than you think. Comment RICE for the guide.",
  cta: { type: "COMMENT_KEYWORD", text: "Comment RICE", keyword: "RICE" },
  hashtags: ["#rice", "#cooking", "#kitchentips"],
  slides: validSlides(),
  ...overrides,
});

const context = (overrides: Partial<ValidationContext> = {}): ValidationContext => ({
  locale: "en",
  forbiddenPatterns: [],
  ideaKnowledgeIds: new Set(["k1", "k2"]),
  numericReference: {
    timings: [{ value: 10, unit: "min" }],
    temperatures: [{ value: 180, unit: "C" }],
  },
  ...overrides,
});

const codes = (issues: ValidationIssue[]) => issues.map((i) => i.code);
const withSlides = (slides: Slide[]) => draft({ slides });
const replace = (id: string, patch: Partial<Slide>) =>
  validSlides().map((s) => (s.id === id ? { ...s, ...patch } : s));

describe("a valid draft", () => {
  it("passes every validator", () => {
    const result = validateDraft(draft(), context());
    expect(result.issues).toEqual([]);
    expect(result.flags).toEqual([]);
  });
});

describe("validateStructure", () => {
  it("fails with fewer than 5 or more than 10 slides, passes at both limits", () => {
    expect(codes(validateStructure(withSlides(validSlides().slice(0, 4)), context()))).toContain(
      "SLIDE_COUNT",
    );
    const eleven = Array.from({ length: 11 }, (_, i) =>
      slide({ id: `x${i}`, role: i === 0 ? "HOOK" : i === 10 ? "CTA" : "STEP" }),
    );
    expect(codes(validateStructure(withSlides(eleven), context()))).toContain("SLIDE_COUNT");
    const ten = eleven.slice(0, 10).map((s, i) => (i === 9 ? { ...s, role: "CTA" as const } : s));
    expect(validateStructure(withSlides(ten), context())).toEqual([]);
  });

  it("requires the first slide to be a hook", () => {
    const issues = validateStructure(withSlides(replace("s1", { role: "PROBLEM" })), context());
    expect(issues).toEqual([
      expect.objectContaining({ code: "FIRST_SLIDE_NOT_HOOK", fieldPath: "slides.s1" }),
    ]);
  });

  it("requires a final CTA slide unless the CTA type is NONE", () => {
    const noCtaSlide = withSlides(replace("s5", { role: "SUMMARY" }));
    expect(codes(validateStructure(noCtaSlide, context()))).toEqual(["LAST_SLIDE_NOT_CTA"]);
    const none = { ...noCtaSlide, cta: { type: "NONE", text: "" } };
    expect(validateStructure(none, context())).toEqual([]);
  });

  it("rejects duplicate slide ids and empty hook or caption", () => {
    const dup = withSlides(replace("s2", { id: "s1" }));
    expect(codes(validateStructure(dup, context()))).toEqual(["DUPLICATE_SLIDE_ID"]);
    expect(codes(validateStructure(draft({ hook: "  ", caption: "" }), context()))).toEqual([
      "HOOK_EMPTY",
      "CAPTION_EMPTY",
    ]);
  });

  it("does not crash on an empty slide list", () => {
    expect(codes(validateStructure(withSlides([]), context()))).toEqual(["SLIDE_COUNT"]);
  });
});

describe("validateSlots", () => {
  it("passes valid slots", () => {
    expect(validateSlots(draft(), context())).toEqual([]);
  });

  it("reports overflow, a missing required slot and an unknown template", () => {
    const slides = replace("s2", { slots: { body: "x".repeat(221) } });
    expect(validateSlots(withSlides(slides), context())).toEqual([
      expect.objectContaining({
        code: "SLOT_OVERFLOW",
        severity: "BLOCKER",
        fieldPath: "slides.s2.slots.body",
      }),
    ]);
    expect(codes(validateSlots(withSlides(replace("s2", { slots: {} })), context()))).toEqual([
      "SLOT_REQUIRED_MISSING",
    ]);
    expect(
      codes(validateSlots(withSlides(replace("s2", { templateId: "Z" as "A" })), context())),
    ).toEqual(["TEMPLATE_UNKNOWN"]);
  });
});

describe("validateCitations", () => {
  it("passes cited factual slides and an uncited non-factual CTA slide", () => {
    expect(validateCitations(draft(), context())).toEqual([]);
  });

  it("blocks a factual slide without a card", () => {
    const issues = validateCitations(withSlides(replace("s2", { knowledgeIds: [] })), context());
    expect(issues).toEqual([
      expect.objectContaining({
        code: "FACTUAL_SLIDE_UNCITED",
        severity: "BLOCKER",
        fieldPath: "slides.s2",
      }),
    ]);
  });

  it("blocks cards that do not belong to the idea", () => {
    const issues = validateCitations(
      withSlides(replace("s2", { knowledgeIds: ["k1", "k9"] })),
      context(),
    );
    expect(issues).toEqual([
      expect.objectContaining({
        code: "CITATION_NOT_IN_IDEA",
        message: expect.stringContaining("k9"),
      }),
    ]);
  });

  it("checks claimsUsed", () => {
    const foreign = draft({ claimsUsed: [{ text: "x", knowledgeIds: ["k9"] }] });
    expect(codes(validateCitations(foreign, context()))).toEqual(["CITATION_NOT_IN_IDEA"]);
    const uncited = draft({ claimsUsed: [{ text: "x", knowledgeIds: [] }] });
    expect(codes(validateCitations(uncited, context()))).toEqual(["CLAIM_UNCITED"]);
    expect(
      validateCitations(draft({ claimsUsed: [{ text: "x", knowledgeIds: ["k2"] }] }), context()),
    ).toEqual([]);
  });

  it("allows chef attribution on a cited slide, blocks it on an uncited one", () => {
    const attribution = "In my kitchen I always salt the water early.";
    expect(
      validateCitations(withSlides(replace("s4", { slots: { body: attribution } })), context()),
    ).toEqual([]);
    const uncited = withSlides(
      replace("s5", { slots: { headline: "Get the guide", body: attribution } }),
    );
    expect(validateCitations(uncited, context())).toEqual([
      expect.objectContaining({
        code: "CHEF_ATTRIBUTION_UNCITED",
        fieldPath: "slides.s5.slots.body",
      }),
    ]);
  });

  it("catches Spanish attributions and ignores words that merely contain them", () => {
    const es = withSlides(
      replace("s5", { slots: { headline: "Mi truco", body: "Según el chef, la sal va primero." } }),
    );
    expect(validateCitations(es, context()).map((i) => i.fieldPath)).toEqual([
      "slides.s5.slots.headline",
      "slides.s5.slots.body",
    ]);
    const plain = withSlides(
      replace("s5", { slots: { headline: "Get the guide", body: "A chef-grade guide, free." } }),
    );
    expect(validateCitations(plain, context())).toEqual([]);
  });

  it("blocks chef attribution in the caption when no slide cites a card", () => {
    const none = validSlides().map((s) => ({ ...s, knowledgeIds: [], factual: false }));
    const issues = validateCitations(
      draft({ slides: none, caption: "As a chef I never rinse rice." }),
      context(),
    );
    expect(issues).toEqual([
      expect.objectContaining({ code: "CHEF_ATTRIBUTION_UNCITED", fieldPath: "caption" }),
    ]);
    expect(
      validateCitations(draft({ caption: "As a chef I never rinse rice." }), context()),
    ).toEqual([]);
  });
});

describe("validateNumericFidelity", () => {
  it("passes numbers from the cards and their conversions", () => {
    const text = "Bake 10 min at 355 °F (180 °C).";
    expect(validateNumericFidelity(draft({ caption: text }), context())).toEqual([]);
  });

  it("blocks a number the cards do not give, with the field path", () => {
    const slides = replace("s3", { slots: { body: "Bake 25 min at 180 °C." } });
    expect(validateNumericFidelity(withSlides(slides), context())).toEqual([
      expect.objectContaining({
        code: "NUMERIC_MISMATCH",
        severity: "BLOCKER",
        fieldPath: "slides.s3.slots.body",
      }),
    ]);
  });

  it("reads es-ES decimal commas", () => {
    const es = draft({ caption: "Hornea 10 minutos a 180 °C y deja 0,5 kg de arroz." });
    const ctx = context({
      locale: "es-ES",
      numericReference: {
        ...context().numericReference,
        ingredients: [{ quantity: 500, unit: "g" }],
      },
    });
    expect(validateNumericFidelity(es, ctx)).toEqual([]);
    expect(codes(validateNumericFidelity(draft({ caption: "Añade 0,7 kg" }), ctx))).toEqual([
      "NUMERIC_MISMATCH",
    ]);
  });

  it("checks the hook, caption and CTA text too", () => {
    const issues = validateNumericFidelity(
      draft({
        hook: "Ready in 5 min",
        caption: "Wait 99 min",
        cta: { type: "SAVE", text: "Save: 3 g" },
      }),
      context(),
    );
    expect(issues.map((i) => i.fieldPath)).toEqual(["hook", "caption", "cta"]);
  });
});

describe("validateForbiddenPatterns", () => {
  const forbidden = [
    { pattern: "healthy", kind: "PHRASE" as const, reason: "health claim" },
    { pattern: String.raw`\bcure[sd]?\b`, kind: "REGEX" as const, reason: "medical claim" },
  ];

  it("passes text without forbidden words", () => {
    expect(validateForbiddenPatterns(draft(), context({ forbiddenPatterns: forbidden }))).toEqual(
      [],
    );
  });

  it("finds phrases as whole words, case-insensitively, in every field", () => {
    const d = draft({
      hook: "A Healthy habit",
      caption: "Not unhealthy at all",
      hashtags: ["#healthy", "#rice", "#tips"],
    });
    const issues = validateForbiddenPatterns(d, context({ forbiddenPatterns: forbidden }));
    expect(issues.map((i) => i.fieldPath)).toEqual(["hook", "hashtags.0"]);
    expect(issues[0]).toMatchObject({
      code: "FORBIDDEN_PATTERN",
      severity: "BLOCKER",
      message: expect.stringContaining("health claim"),
    });
  });

  it("applies regex patterns and slide slots", () => {
    const slides = replace("s2", { slots: { body: "This cures everything." } });
    const issues = validateForbiddenPatterns(
      withSlides(slides),
      context({ forbiddenPatterns: forbidden }),
    );
    expect(issues).toEqual([
      expect.objectContaining({
        fieldPath: "slides.s2.slots.body",
        message: expect.stringContaining("medical claim"),
      }),
    ]);
  });

  it("matches accented phrases and ignores a broken stored regex", () => {
    const accented = [
      { pattern: "sano", kind: "PHRASE" as const, reason: "claim" },
      { pattern: "(", kind: "REGEX" as const, reason: "broken" },
    ];
    const issues = validateForbiddenPatterns(
      draft({ caption: "Muy sano" }),
      context({ forbiddenPatterns: accented }),
    );
    expect(issues.map((i) => i.fieldPath)).toEqual(["caption"]);
  });
});

describe("validateTextRules", () => {
  it("passes a normal draft", () => {
    expect(validateTextRules(draft(), context())).toEqual([]);
  });

  it("limits the caption to 2,200 characters", () => {
    expect(validateTextRules(draft({ caption: "x".repeat(2200) }), context())).toEqual([]);
    expect(codes(validateTextRules(draft({ caption: "x".repeat(2201) }), context()))).toEqual([
      "CAPTION_TOO_LONG",
    ]);
  });

  it("wants 3–5 well-formed hashtags and treats the count as a non-blocker", () => {
    const two = validateTextRules(draft({ hashtags: ["#a", "#b"] }), context());
    expect(two).toEqual([expect.objectContaining({ code: "HASHTAG_COUNT", severity: "MAJOR" })]);
    expect(
      validateTextRules(draft({ hashtags: ["#a", "#b", "#c", "#d", "#e"] }), context()),
    ).toEqual([]);
    expect(
      codes(
        validateTextRules(draft({ hashtags: ["#a", "#b", "#c", "#d", "#e", "#f"] }), context()),
      ),
    ).toEqual(["HASHTAG_COUNT"]);
    expect(
      codes(validateTextRules(draft({ hashtags: ["rice", "#two words", "#ok"] }), context())),
    ).toEqual(["HASHTAG_FORMAT", "HASHTAG_FORMAT"]);
    expect(
      codes(validateTextRules(draft({ hashtags: ["#Rice", "#rice", "#ok"] }), context())),
    ).toEqual(["HASHTAG_DUPLICATE"]);
    expect(
      validateTextRules(draft({ hashtags: ["#cocina_española", "#paella", "#ñoquis"] }), context()),
    ).toEqual([]);
  });

  it.each([
    ["RICE", true],
    ["ARROZ", true],
    ["PAÑO", true],
    ["RISOTTO2", true],
    ["AB", false],
    ["rice", false],
    ["A".repeat(17), false],
    ["RI CE", false],
  ])("CTA keyword %s → valid: %s", (keyword, valid) => {
    const issues = validateTextRules(
      draft({ cta: { type: "COMMENT_KEYWORD", text: "x", keyword } }),
      context(),
    );
    expect(issues.length === 0).toBe(valid);
  });

  it("requires a keyword for keyword CTAs only", () => {
    expect(
      codes(validateTextRules(draft({ cta: { type: "DM_KEYWORD", text: "x" } }), context())),
    ).toEqual(["CTA_KEYWORD_MISSING"]);
    expect(
      validateTextRules(draft({ cta: { type: "SAVE", text: "Save this" } }), context()),
    ).toEqual([]);
  });

  it("blocks links and emoji on slides but not in the caption", () => {
    const bad = replace("s2", {
      slots: { body: "Read more at www.example.com or https://x.io/a" },
    });
    expect(validateTextRules(withSlides(bad), context())).toEqual([
      expect.objectContaining({ code: "URL_IN_SLIDE", fieldPath: "slides.s2.slots.body" }),
    ]);
    expect(
      codes(
        validateTextRules(
          withSlides(replace("s2", { slots: { body: "Reg.example.com rocks" } })),
          context(),
        ),
      ),
    ).toEqual(["URL_IN_SLIDE"]);
    expect(
      codes(
        validateTextRules(withSlides(replace("s2", { slots: { body: "Tasty 🍚" } })), context()),
      ),
    ).toEqual(["EMOJI_IN_SLIDE"]);
    expect(
      validateTextRules(
        withSlides(replace("s2", { slots: { body: "Reg.Chef™ © 2026, 180 °C, e.g. fine" } })),
        context(),
      ),
    ).toEqual([]);
    expect(validateTextRules(draft({ caption: "Tasty 🍚 www.example.com" }), context())).toEqual(
      [],
    );
  });
});

describe("blocking classification and flags", () => {
  const issue = (code: string, severity: ValidationIssue["severity"]): ValidationIssue => ({
    code,
    severity,
    message: code,
  });

  it("treats only BLOCKER as blocking", () => {
    expect(isBlocking(issue("A", "BLOCKER"))).toBe(true);
    expect(isBlocking(issue("A", "MAJOR"))).toBe(false);
    const split = splitIssues([issue("A", "BLOCKER"), issue("B", "MAJOR"), issue("C", "MINOR")]);
    expect(codes(split.blocking)).toEqual(["A"]);
    expect(codes(split.nonBlocking)).toEqual(["B", "C"]);
  });

  it("maps leftover issues to variant flags once each", () => {
    expect(
      flagsForIssues([
        issue("NUMERIC_MISMATCH", "BLOCKER"),
        issue("NUMERIC_MISMATCH", "BLOCKER"),
        issue("FACTUAL_SLIDE_UNCITED", "BLOCKER"),
        issue("CITATION_NOT_IN_IDEA", "BLOCKER"),
        issue("SLOT_LINES", "MAJOR"),
        issue("HASHTAG_COUNT", "MAJOR"),
      ]),
    ).toEqual(["NUMERIC_MISMATCH", "UNSUPPORTED_CLAIM", "TEXT_OVERFLOW"]);
  });
});

describe("validateDraft", () => {
  it("combines the validators and splits blocking from the rest", () => {
    const bad = draft({
      hashtags: ["#a"],
      slides: replace("s3", { slots: { body: "Bake 25 min at 180 °C." }, knowledgeIds: [] }),
    });
    const result = validateDraft(bad, context());
    expect(codes(result.blocking)).toEqual(["FACTUAL_SLIDE_UNCITED", "NUMERIC_MISMATCH"]);
    expect(codes(result.nonBlocking)).toEqual(["HASHTAG_COUNT"]);
    expect(result.flags).toEqual(["UNSUPPORTED_CLAIM", "NUMERIC_MISMATCH"]);
  });
});

describe("@rc/templates and @rc/db agree", () => {
  it("share the slide roles and template ids", () => {
    expect([...SLIDE_ROLES]).toEqual([...DB_ROLES]);
    expect([...TEMPLATE_IDS]).toEqual([...DB_TEMPLATES]);
  });
});
