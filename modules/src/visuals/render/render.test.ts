import { gradientPng } from "@rc/lib/providers/image";
import { registry } from "@rc/templates";
import { TEMPLATE_FIXTURES } from "@rc/templates/fixtures";
import { buildTheme } from "@rc/templates/render";
import type { Browser } from "playwright-core";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { buildQaReport, judgeQa, logoPlacementOk, type PageMeasurement } from "./qa";
import { launchBrowser, type RenderInputSlide, renderCarousel } from "./renderer";

// Rendering needs a Chromium: the pre-installed one in cloud sessions, the one CI installs, a local
// Chrome on a Mac. Without a browser the browser tests are skipped.

const browser: Browser | undefined = await launchBrowser().catch(() => undefined);
afterAll(async () => {
  await browser?.close();
});
const needBrowser = (): Browser => browser as Browser;

const dataUrl = (png: Uint8Array) => `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
const PICTURE = dataUrl(gradientPng(540, 675, "render-test"));
const theme = buildTheme({});

const inputFor = (templateId: string, name: string, withImages = true): RenderInputSlide => {
  const slide = TEMPLATE_FIXTURES[templateId]?.[name];
  if (!slide) throw new Error("no fixture");
  const images: Record<string, string> = {};
  if (withImages) {
    for (const slot of Object.keys(registry.get(templateId)?.imageSlots ?? {}))
      images[slot] = PICTURE;
  }
  return { slide, assets: { images } };
};

describe("QA decisions (no browser)", () => {
  const measurement = (over: Partial<PageMeasurement> = {}): PageMeasurement => ({
    slideId: "s1",
    overflow: [],
    missingRequiredImages: [],
    brokenImages: [],
    logo: {
      box: { x: 72, y: 1230, width: 200, height: 48 },
      expected: { anchor: "bottom-left", heightPx: 48 },
      marginPx: 72,
    },
    ...over,
  });
  const files = [{ width: 1080, height: 1350, bytes: 200_000 }];
  const report = (m: PageMeasurement[], f = files, missingGlyphs: never[] = []) =>
    buildQaReport({ measurements: m, files: f, missingGlyphs, durationMs: 5 });

  it("passes a clean render", () => {
    const qa = report([measurement()]);
    expect(qa).toMatchObject({ dimensionsOk: true, logoPlacementOk: true, overflow: [] });
    expect(judgeQa(qa, { missingRequiredImages: [], brokenImages: [] })).toMatchObject({
      ok: true,
      flags: [],
    });
  });

  it("maps findings to flags", () => {
    const overflow = report([measurement({ overflow: [{ slot: "headline", fontPxUsed: 64 }] })]);
    expect(overflow.overflow).toEqual([{ slideId: "s1", slot: "headline", fontPxUsed: 64 }]);
    expect(judgeQa(overflow, { missingRequiredImages: [], brokenImages: [] }).flags).toEqual([
      "TEXT_OVERFLOW",
    ]);
    const glyphs = report([], [], [{ slideId: "s1", slot: "body", chars: ["🔥"] }] as never);
    expect(judgeQa(glyphs, { missingRequiredImages: [], brokenImages: [] }).flags).toEqual([
      "MISSING_GLYPH",
    ]);
    const clean = report([measurement()]);
    expect(
      judgeQa(clean, { missingRequiredImages: [{ slideId: "s1", slot: "hero" }], brokenImages: [] })
        .flags,
    ).toEqual(["VISUAL_MISSING"]);
    expect(
      judgeQa(clean, { missingRequiredImages: [], brokenImages: [{ slideId: "s1", slot: "hero" }] })
        .flags,
    ).toEqual(["RENDER_FAILED"]);
  });

  it("flags a wrong size, a big file and a logo in the wrong place", () => {
    const wrong = report([measurement()], [{ width: 1080, height: 1349, bytes: 9 * 1024 * 1024 }]);
    expect(wrong.dimensionsOk).toBe(false);
    expect(judgeQa(wrong, { missingRequiredImages: [], brokenImages: [] }).flags).toEqual([
      "RENDER_FAILED",
    ]);
    const moved = measurement().logo;
    expect(logoPlacementOk(moved)).toBe(true);
    expect(logoPlacementOk({ ...moved, box: { x: 80, y: 1230, width: 200, height: 48 } })).toBe(
      false,
    );
    expect(logoPlacementOk({ ...moved, box: { x: 73, y: 1231, width: 200, height: 49 } })).toBe(
      true,
    );
    expect(logoPlacementOk({ ...moved, box: null })).toBe(false);
    const right = {
      box: { x: 808, y: 72, width: 200, height: 48 },
      expected: { anchor: "top-right" as const, heightPx: 48 },
      marginPx: 72,
    };
    expect(logoPlacementOk(right)).toBe(true);
  });
});

describe.skipIf(!browser)("renderCarousel", () => {
  const fixtureNames = ["es-long", "en-short", "special-chars"];

  it.each(["A", "B", "C", "D", "E", "F"])(
    "renders the regular fixtures of template %s at 1080 × 1350 without a QA problem",
    async (id) => {
      const slides = fixtureNames.map((name) => inputFor(id, name));
      const result = await renderCarousel({ slides, theme }, { browser: needBrowser() });
      expect(result.slides).toHaveLength(3);
      expect(result.verdict.problems).toEqual([]);
      expect(result.qa).toMatchObject({ dimensionsOk: true, logoPlacementOk: true, overflow: [] });
      for (const slide of result.slides) {
        const meta = await sharp(slide.jpeg).metadata();
        expect(meta).toMatchObject({ format: "jpeg", width: 1080, height: 1350, space: "srgb" });
        expect(slide.bytes).toBeLessThan(2 * 1024 * 1024);
        expect(slide.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    },
    120_000,
  );

  it("renders the maximum-length fixtures without overflow (the limits fit the layout)", async () => {
    const slides = ["A", "B", "C", "D", "E", "F"].map((id) => inputFor(id, "max-length"));
    const result = await renderCarousel({ slides, theme }, { browser: needBrowser() });
    expect(result.qa.overflow).toEqual([]);
    expect(result.verdict.problems).toEqual([]);
  }, 120_000);

  it("is deterministic: the same input gives the same JPEG bytes", async () => {
    const slides = [inputFor("A", "es-long"), inputFor("F", "es-long")];
    const a = await renderCarousel({ slides, theme }, { browser: needBrowser() });
    const b = await renderCarousel({ slides, theme }, { browser: needBrowser() });
    expect(a.slides.map((s) => s.sha256)).toEqual(b.slides.map((s) => s.sha256));
  }, 120_000);

  it("catches a forced overflow: a word that cannot wrap", async () => {
    const forced = inputFor("A", "no-optionals");
    forced.slide = { ...forced.slide, slots: { headline: "X".repeat(400) } };
    const result = await renderCarousel({ slides: [forced], theme }, { browser: needBrowser() });
    expect(result.qa.overflow).toMatchObject([
      { slideId: forced.slide.id, slot: "headline", fontPxUsed: 64 },
    ]);
    expect(result.verdict).toMatchObject({ ok: false, flags: ["TEXT_OVERFLOW"] });
  }, 60_000);

  it("reports a required picture that is missing", async () => {
    const slides = [inputFor("A", "es-long", false)];
    const result = await renderCarousel({ slides, theme }, { browser: needBrowser() });
    expect(result.verdict.flags).toContain("VISUAL_MISSING");
  }, 60_000);

  it("stops on a missing glyph before any browser starts", async () => {
    const slide = inputFor("B", "en-short");
    slide.slide = { ...slide.slide, slots: { ...slide.slide.slots, body: "Hot 🔥" } };
    // No browser option and an unusable path: a launch would throw.
    const result = await renderCarousel(
      { slides: [slide], theme },
      { executablePath: "/nonexistent" },
    );
    expect(result.slides).toEqual([]);
    expect(result.qa.missingGlyphs).toEqual([
      { slideId: slide.slide.id, slot: "body", chars: ["🔥"] },
    ]);
    expect(result.verdict.flags).toEqual(["MISSING_GLYPH"]);
  });
});
