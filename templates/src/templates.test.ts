import { describe, expect, it } from "vitest";
import { renderTemplateCatalog } from "./catalog";
import {
  defineTemplate,
  SLIDE_ROLES,
  TEMPLATE_IDS,
  type TemplateDefinition,
} from "./define-template";
import { createRegistry, registry } from "./registry";
import {
  countChars,
  estimateLines,
  slotAtSmallestSize,
  validateSlideAgainstTemplate,
} from "./validate";

const slide = (overrides: Record<string, unknown> = {}) => ({
  id: "s1",
  role: "HOOK",
  templateId: "A",
  slots: { headline: "Stop rinsing the rice" },
  images: { hero: {} },
  ...overrides,
});

const codes = (s: ReturnType<typeof slide>) => validateSlideAgainstTemplate(s).map((i) => i.code);

describe("registry", () => {
  it("holds the six templates of plan 08 §8.2.1 with their priorities", () => {
    expect(registry.list().map((t) => t.id)).toEqual([...TEMPLATE_IDS]);
    expect(registry.list({ priority: "P0" }).map((t) => t.id)).toEqual(["A", "B", "E", "F"]);
    expect(registry.list({ priority: "P1" }).map((t) => t.id)).toEqual(["C", "D"]);
  });

  it("matches the limits of the plan table", () => {
    const a = registry.get("A");
    expect(a?.textSlots.kicker).toMatchObject({ maxChars: 24, maxLines: 1, required: false });
    expect(a?.textSlots.headline).toMatchObject({ maxChars: 70, maxLines: 4, required: true });
    expect(a?.imageSlots.hero).toEqual({ aspect: "4:5", required: true, fullBleed: true });
    // Carousel v3 (docs/design/carousel-v3-requirements.md T3, T4): ladder bodies in a narrow column.
    expect(registry.get("B")?.textSlots.body).toMatchObject({ maxChars: 380, maxLines: 13 });
    expect(registry.get("B")?.textSlots.lead).toMatchObject({ maxChars: 50, required: false });
    expect(registry.get("B")?.textSlots.closer).toMatchObject({ maxChars: 60, required: false });
    expect(registry.get("E")?.textSlots.mistakeText).toMatchObject({ maxChars: 200, maxLines: 7 });
    expect(registry.get("F")?.textSlots.keyword).toMatchObject({ maxChars: 16, required: false });
    expect(registry.get("C")?.imageSlots.before).toEqual({ aspect: "4:5", required: true });
    expect(registry.get("B")?.imageSlots.side).toEqual({ aspect: "4:5", required: false });
    expect(Object.keys(registry.get("D")?.textSlots ?? {})).toHaveLength(6);
  });

  it("gives every slide role except COMPARISON a P0 template", () => {
    // COMPARISON is only carried by template C (P1); plan 08 §8.2.1 says otherwise (decision log, M2-03).
    for (const role of SLIDE_ROLES.filter((r) => r !== "COMPARISON")) {
      expect(registry.forRole(role, { priority: "P0" }).length, role).toBeGreaterThan(0);
    }
    expect(registry.forRole("COMPARISON", { priority: "P0" })).toEqual([]);
    expect(registry.forRole("COMPARISON").map((t) => t.id)).toEqual(["C"]);
    expect(registry.forRole("EXPLANATION").map((t) => t.id)).toEqual(["B", "D"]);
  });

  it("keeps body fonts at or above 26 px", () => {
    // Plan 08 asked for 32 px; carousel v3 (T4, decision log 2026-10-17) follows the reference
    // account's denser slides (27–35 px on a 1080 px slide) with a 26 px floor.
    for (const t of registry.list()) {
      for (const [name, slot] of Object.entries(t.textSlots)) {
        if (slot.font === "body") expect(slot.minPx, `${t.id}.${name}`).toBeGreaterThanOrEqual(26);
      }
    }
  });

  it("reports a version string and rejects duplicate ids", () => {
    expect(registry.version({ priority: "P0" })).toBe("A@3.0.0,B@3.0.0,E@3.0.0,F@3.0.0");
    const a = registry.get("A") as TemplateDefinition;
    expect(() => createRegistry([a, a])).toThrow(/Duplicate/);
  });

  it("freezes definitions", () => {
    expect(Object.isFrozen(registry.get("A"))).toBe(true);
    expect(Object.isFrozen(registry.get("A")?.textSlots)).toBe(true);
  });
});

describe("defineTemplate", () => {
  const slot = {
    maxChars: 10,
    maxLines: 1,
    required: true,
    font: "display",
    minPx: 30,
    maxPx: 40,
  } as const;
  const valid: TemplateDefinition = {
    id: "A",
    version: "1.0.0",
    name: "x",
    priority: "P0",
    roles: ["HOOK"],
    textSlots: { h: slot },
    imageSlots: {},
    logo: { anchor: "bottom-left", heightPx: 48 },
  };

  it("accepts a valid definition and rejects broken ones", () => {
    expect(() => defineTemplate(valid)).not.toThrow();
    expect(() => defineTemplate({ ...valid, version: "1.0" })).toThrow(/semver/);
    expect(() => defineTemplate({ ...valid, roles: [] })).toThrow(/role/);
    expect(() => defineTemplate({ ...valid, roles: ["HOOK", "HOOK"] })).toThrow(/duplicate/);
    expect(() => defineTemplate({ ...valid, textSlots: {} })).toThrow(/text slot/);
    expect(() =>
      defineTemplate({
        ...valid,
        textSlots: { h: { ...slot, minPx: 50 } },
      }),
    ).toThrow(/font size/);
    expect(() =>
      defineTemplate({
        ...valid,
        textSlots: { h: { ...slot, maxChars: 0 } },
      }),
    ).toThrow(/maxChars/);
    expect(() =>
      defineTemplate({ ...valid, imageSlots: { h: { aspect: "1:1", required: false } } }),
    ).toThrow(/both/);
  });
});

describe("countChars and estimateLines", () => {
  it("counts accents once whether composed or decomposed", () => {
    expect(countChars("café")).toBe(4);
    expect(countChars("café")).toBe(4);
    expect(countChars("")).toBe(0);
  });

  it("wraps words greedily and honors newlines", () => {
    const slot = { maxChars: 20, maxLines: 2 }; // 11 chars per line
    expect(estimateLines("one two", slot)).toBe(1);
    expect(estimateLines("aaaa bbbb cccc", slot)).toBe(2);
    expect(estimateLines("a\nb\nc", slot)).toBe(3);
    // A blank line between groups is a half-line gap, however many newlines make it.
    expect(estimateLines("a\nb\n\nc\nd", slot)).toBe(5);
    expect(estimateLines("a\n\n\nb\n\nc", slot)).toBe(4);
    expect(estimateLines("x".repeat(25), slot)).toBe(3);
  });
});

describe("validateSlideAgainstTemplate", () => {
  it("passes a valid hook slide", () => {
    expect(codes(slide())).toEqual([]);
  });

  it("flags an unknown template as the only issue", () => {
    expect(validateSlideAgainstTemplate(slide({ templateId: "Z" }))).toEqual([
      expect.objectContaining({
        code: "TEMPLATE_UNKNOWN",
        severity: "BLOCKER",
        fieldPath: "slides.s1",
      }),
    ]);
  });

  it("flags a role the template cannot carry", () => {
    expect(codes(slide({ role: "CTA" }))).toEqual(["ROLE_NOT_ALLOWED"]);
  });

  it("flags characters over the limit with the slot path", () => {
    const issues = validateSlideAgainstTemplate(
      slide({ slots: { headline: "x".repeat(71), kicker: "short" } }),
    );
    expect(issues).toEqual([
      expect.objectContaining({
        code: "SLOT_OVERFLOW",
        severity: "BLOCKER",
        fieldPath: "slides.s1.slots.headline",
      }),
    ]);
  });

  it("accepts text exactly at the limit", () => {
    expect(codes(slide({ slots: { headline: "x".repeat(70) } }))).toEqual([]);
    expect(codes(slide({ slots: { headline: "ñ".repeat(70) } }))).toEqual([]);
  });

  it("reports estimated line overflow as a MAJOR issue, not a blocker", () => {
    // A's headline holds 4 lines at 100 px and 6 at its smallest 64 px: 7 short lines are too many.
    const issues = validateSlideAgainstTemplate(
      slide({
        slots: { headline: ["Uno", "Dos", "Tres", "Cuatro", "Cinco", "Seis", "Siete"].join("\n") },
      }),
    );
    expect(issues).toEqual([
      expect.objectContaining({
        code: "SLOT_LINES",
        severity: "MAJOR",
        fieldPath: "slides.s1.slots.headline",
      }),
    ]);
    // Five words of 12 characters fit once fit-text shrinks them (two words to a line at 64 px).
    const word = "a".repeat(12);
    expect(codes(slide({ slots: { headline: [word, word, word, word, word].join(" ") } }))).toEqual(
      [],
    );
    expect(slotAtSmallestSize({ maxChars: 380, maxLines: 13, minPx: 26, maxPx: 30 })).toEqual({
      maxLines: 15,
      maxChars: 506,
    });
  });

  it("does not count the emphasis markers", () => {
    // 14 marked words of 4 letters: 125 characters with the markers, 69 without.
    const marked = Array.from({ length: 14 }, () => "**abcd**").join(" ");
    expect(countChars(marked)).toBe(125);
    expect(codes(slide({ slots: { headline: marked } }))).toEqual([]);
  });

  it("flags empty and missing required slots, unknown slots and unknown images", () => {
    expect(codes(slide({ slots: {} }))).toEqual(["SLOT_REQUIRED_MISSING"]);
    expect(codes(slide({ slots: { headline: "   " } }))).toEqual(["SLOT_REQUIRED_MISSING"]);
    expect(codes(slide({ slots: { headline: "ok", tagline: "nope" } }))).toEqual(["SLOT_UNKNOWN"]);
    expect(codes(slide({ images: { hero: {}, logo: {} } }))).toEqual(["IMAGE_SLOT_UNKNOWN"]);
  });

  it("does not require image slots at text stage", () => {
    expect(codes(slide({ images: {} }))).toEqual([]);
  });

  it("checks template E and F required slots", () => {
    expect(
      codes(
        slide({ templateId: "E", role: "MISTAKE", slots: { mistakeTitle: "Wrong" }, images: {} }),
      ),
    ).toEqual(["SLOT_REQUIRED_MISSING", "SLOT_REQUIRED_MISSING", "SLOT_REQUIRED_MISSING"]);
    expect(
      codes(
        slide({
          templateId: "F",
          role: "CTA",
          slots: { headline: "Get the guide", body: "Comment RICE", keyword: "RICE" },
          images: {},
        }),
      ),
    ).toEqual([]);
  });

  it("uses a custom registry when given one", () => {
    const only = createRegistry([registry.get("F") as TemplateDefinition]);
    expect(validateSlideAgainstTemplate(slide(), only).map((i) => i.code)).toEqual([
      "TEMPLATE_UNKNOWN",
    ]);
  });
});

describe("renderTemplateCatalog", () => {
  it("lists the P0 templates compactly and deterministically", () => {
    const text = renderTemplateCatalog();
    expect(text).toMatchInlineSnapshot(`
      "A "Hero ingredient + strong hook" v3.0.0; roles: HOOK
        text: kicker ≤24 chars/1 line (optional); headline ≤70 chars/4 lines; subline ≤140 chars/4 lines (optional)
        images: hero 4:5 full-bleed
      B "Large number / fact + explanation" v3.0.0; roles: FACT, EXPLANATION, STEP, SUMMARY, PROBLEM
        text: number ≤8 chars/1 line (optional); label ≤40 chars/1 line (optional); lead ≤50 chars/2 lines (optional); headline ≤60 chars/3 lines (optional); body ≤380 chars/13 lines; closer ≤60 chars/2 lines (optional)
        images: side 4:5 (optional)
      E "Mistake vs correct technique" v3.0.0; roles: MISTAKE, CORRECT
        text: mistakeTitle ≤40 chars/2 lines; mistakeText ≤200 chars/7 lines; correctTitle ≤40 chars/3 lines; correctText ≤300 chars/10 lines; closer ≤60 chars/2 lines (optional)
        images: image 4:5 (optional)
      F "CTA / lead magnet / offer" v3.0.0; roles: CTA
        text: headline ≤60 chars/3 lines; body ≤300 chars/11 lines; keyword ≤16 chars/1 line (optional); offerName ≤40 chars/2 lines (optional)
        images: product 4:5 (optional)"
    `);
    expect(renderTemplateCatalog()).toBe(text);
  });

  it("can include P1 templates", () => {
    const all = renderTemplateCatalog({ priority: "ALL" });
    expect(all).toContain('C "Before vs after"');
    expect(all).toContain('D "Diagram / mechanism"');
    expect(renderTemplateCatalog()).not.toContain('C "Before vs after"');
  });
});
