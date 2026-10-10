import type { Slide } from "@rc/db/json";
import { ValidationError } from "@rc/lib/errors";
import { describe, expect, it } from "vitest";
import {
  affectsRender,
  formatFieldPath,
  isWithin,
  parseFieldPath,
  readField,
  tryParseFieldPath,
  type VariantContent,
  valueSchema,
  writeField,
} from "./field-path";
import { fixtureSlides } from "./test-support";

const content = (): VariantContent => ({
  hook: "Hola",
  caption: "Pie",
  cta: { type: "SAVE", text: "Guárdalo" },
  hashtags: ["#a", "#b", "#c"],
  slides: fixtureSlides(),
  visualBrief: null,
});

describe("FieldPath", () => {
  it("parses every form of the grammar and prints it back", () => {
    for (const [path, parsed] of [
      ["hook", { kind: "hook" }],
      ["caption", { kind: "caption" }],
      ["cta", { kind: "cta" }],
      ["hashtags", { kind: "hashtags" }],
      ["visualBrief", { kind: "visualBrief" }],
      ["slides.s1", { kind: "slide", slideId: "s1" }],
      [
        "slides.V1StGXR8_Z5jdHi6B-myT.slots.headline",
        { kind: "slot", slideId: "V1StGXR8_Z5jdHi6B-myT", slot: "headline" },
      ],
      ["slides.s2.images.side", { kind: "image", slideId: "s2", slot: "side" }],
    ] as const) {
      expect(parseFieldPath(path)).toEqual(parsed);
      expect(formatFieldPath(parseFieldPath(path))).toBe(path);
    }
  });

  it("refuses anything else", () => {
    for (const bad of [
      "",
      "title",
      "slides",
      "slides.",
      "slides.s1.slots",
      "slides.s1.text.x",
      "slides.s1.slots.a.b",
      "slides.0 .x",
      "hook.x",
      "hashtags.1",
    ]) {
      expect(tryParseFieldPath(bad)).toBeNull();
    }
    expect(() => parseFieldPath("title")).toThrow(ValidationError);
  });

  it("reads and writes each kind without touching the original", () => {
    const base = content();
    const snapshot = structuredClone(base);
    expect(readField(base, parseFieldPath("hook"))).toBe("Hola");
    expect(readField(base, parseFieldPath("slides.s2.slots.body"))).toBe("Texto.");
    expect(readField(base, parseFieldPath("slides.s2.slots.nope"))).toBeNull();
    expect(readField(base, parseFieldPath("slides.s2.images.side"))).toBeNull();

    expect(writeField(base, parseFieldPath("hook"), "Nuevo").hook).toBe("Nuevo");
    expect(writeField(base, parseFieldPath("caption"), "X").caption).toBe("X");
    expect(writeField(base, parseFieldPath("hashtags"), ["#x"]).hashtags).toEqual(["#x"]);
    expect(writeField(base, parseFieldPath("cta"), { type: "NONE", text: "" }).cta.type).toBe(
      "NONE",
    );
    expect(
      writeField(base, parseFieldPath("slides.s2.slots.body"), "Otro.").slides[1]?.slots.body,
    ).toBe("Otro.");
    expect(
      writeField(base, parseFieldPath("slides.s2.images.side"), { assetId: "a1" }).slides[1]
        ?.images,
    ).toEqual({ side: { assetId: "a1" } });
    expect(writeField(base, parseFieldPath("slides.s2.images.side"), {}).slides[1]?.images).toEqual(
      { side: {} },
    );
    expect(base).toEqual(snapshot);
  });

  it("replaces a whole slide but keeps its id and position", () => {
    const base = content();
    const slide = {
      ...structuredClone(base.slides[1] as Slide),
      index: 7,
      slots: { body: "Nuevo cuerpo." },
    };
    const next = writeField(base, parseFieldPath("slides.s2"), slide);
    expect(next.slides[1]).toMatchObject({ id: "s2", index: 1, slots: { body: "Nuevo cuerpo." } });
    expect(() => writeField(base, parseFieldPath("slides.s2"), { ...slide, id: "other" })).toThrow(
      /keeps its id/,
    );
  });

  it("refuses a slide that does not exist", () => {
    expect(() => readField(content(), parseFieldPath("slides.zz.slots.body"))).toThrow(
      ValidationError,
    );
    expect(() => writeField(content(), parseFieldPath("slides.zz.slots.body"), "x")).toThrow(
      ValidationError,
    );
  });

  it("checks the value shape per kind", () => {
    const ok = (path: string, value: unknown) =>
      valueSchema(parseFieldPath(path)).safeParse(value).success;
    expect(ok("hook", "  Hola  ")).toBe(true);
    expect(ok("hook", "")).toBe(false);
    expect(ok("hook", "x".repeat(301))).toBe(false);
    expect(ok("hook", 4)).toBe(false);
    expect(ok("caption", " ")).toBe(false);
    expect(
      ok(
        "hashtags",
        Array.from({ length: 30 }, (_, i) => `#t${i}`),
      ),
    ).toBe(true);
    expect(
      ok(
        "hashtags",
        Array.from({ length: 31 }, (_, i) => `#t${i}`),
      ),
    ).toBe(false);
    expect(ok("hashtags", "#a")).toBe(false);
    expect(ok("cta", { type: "SAVE", text: "x" })).toBe(true);
    expect(ok("cta", { text: "x" })).toBe(false);
    expect(ok("slides.s1.slots.headline", "")).toBe(true);
    expect(ok("slides.s1.slots.headline", 1)).toBe(false);
    expect(ok("slides.s1.images.bg", { assetId: "a" })).toBe(true);
    expect(ok("slides.s1.images.bg", { assetId: "" })).toBe(false);
    expect(ok("slides.s1", fixtureSlides()[0])).toBe(true);
    expect(ok("slides.s1", { id: "s1" })).toBe(false);
  });

  it("knows which fields need a new render and which issue paths belong to a field", () => {
    expect(affectsRender(parseFieldPath("slides.s1.slots.headline"))).toBe(true);
    expect(affectsRender(parseFieldPath("slides.s1"))).toBe(true);
    expect(affectsRender(parseFieldPath("slides.s1.images.bg"))).toBe(true);
    for (const p of ["hook", "caption", "cta", "hashtags", "visualBrief"]) {
      expect(affectsRender(parseFieldPath(p))).toBe(false);
    }
    const slide = parseFieldPath("slides.s1");
    expect(isWithin("slides.s1", slide)).toBe(true);
    expect(isWithin("slides.s1.slots.headline", slide)).toBe(true);
    expect(isWithin("slides.s10", slide)).toBe(false);
    expect(isWithin("slides.s1x.slots.a", slide)).toBe(false);
    expect(isWithin(undefined, slide)).toBe(false);
    expect(isWithin("hashtags.2", parseFieldPath("hashtags"))).toBe(true);
    expect(isWithin("caption", parseFieldPath("hashtags"))).toBe(false);
  });
});
