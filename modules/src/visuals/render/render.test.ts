import { gradientPng } from "@rc/lib/providers/image";
import { registry } from "@rc/templates";
import { TEMPLATE_FIXTURES } from "@rc/templates/fixtures";
import { buildTheme } from "@rc/templates/render";
import type { Browser } from "playwright-core";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildQaReport,
  contrastRatio,
  judgeQa,
  logoPlacementOk,
  type PageMeasurement,
  worstContrast,
} from "./qa";
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

describe("contrast (no browser)", () => {
  it("computes the WCAG ratio: 21:1 for black on white, 1:1 for the same colour", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([120, 130, 140], [120, 130, 140])).toBe(1);
    // The reference pair from WCAG: #767676 on white is 4.54:1.
    expect(contrastRatio([0x76, 0x76, 0x76], [255, 255, 255])).toBeCloseTo(4.54, 1);
  });

  it("takes the worst 5 % of the pixels under a box, not one stray pixel", () => {
    const width = 40;
    const height = 40;
    const data = new Uint8Array(width * height * 3).fill(255); // white
    // Text is black: 21:1 everywhere, except a dark patch of 10 % of the box.
    const dark = (x: number, y: number) => {
      const i = (y * width + x) * 3;
      data[i] = data[i + 1] = data[i + 2] = 10;
    };
    for (let y = 0; y < 40; y += 1) for (let x = 0; x < 4; x += 1) dark(x, y);
    const image = { data, width, height, channels: 3 };
    const box = { x: 0, y: 0, width, height };
    expect(worstContrast([0, 0, 0], box, image, 1)).toBeLessThan(2);
    // A single dark pixel is not enough to fail the slot.
    const one = new Uint8Array(width * height * 3).fill(255);
    one[0] = one[1] = one[2] = 10;
    expect(worstContrast([0, 0, 0], box, { data: one, width, height, channels: 3 }, 1)).toBeCloseTo(
      21,
      0,
    );
  });
});

describe("QA decisions (no browser)", () => {
  const measurement = (over: Partial<PageMeasurement> = {}): PageMeasurement => ({
    slideId: "s1",
    overflow: [],
    missingRequiredImages: [],
    brokenImages: [],
    slots: [],
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

  it("warns about text with too little contrast, but does not block the render", async () => {
    // Light text on a light background: the slide is readable by nobody.
    const faint = buildTheme({
      colors: { ...buildTheme({}).colors, text: "#F4EFE6" },
      fonts: { display: "fraunces", body: "inter" },
      logo: { assetKey: "", minHeightPx: 48 },
      spacing: { safeMarginPx: 72 },
      themeVariants: {},
    });
    const result = await renderCarousel(
      { slides: [inputFor("F", "en-short")], theme: faint },
      { browser: needBrowser() },
    );
    expect(result.qa.lowContrast?.map((c) => c.slot).sort()).toEqual(["body", "headline"]);
    expect(result.qa.lowContrast?.[0]?.ratio).toBeLessThan(2);
    expect(result.verdict.ok).toBe(true);
    expect(result.verdict.warnings[0]).toContain("Low contrast");
  }, 60_000);

  it("finds no contrast problem in the regular fixtures", async () => {
    const slides = ["A", "B", "C", "D", "E", "F"].map((id) => inputFor(id, "es-long"));
    const result = await renderCarousel({ slides, theme }, { browser: needBrowser() });
    expect(result.qa.lowContrast).toBeUndefined();
  }, 120_000);

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
