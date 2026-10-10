import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import type { QaReport } from "@rc/db/json";
import { registry } from "@rc/templates";
import {
  findMissingGlyphs,
  type RenderAssets,
  renderSlideHtml,
  type SlideData,
  type SlotText,
  type Theme,
} from "@rc/templates/render";
import { type Browser, chromium } from "playwright-core";
import sharp from "sharp";
import {
  buildQaReport,
  EXPECTED,
  judgeQa,
  MAX_JPEG_BYTES,
  type PageMeasurement,
  type QaVerdict,
} from "./qa";

// The carousel renderer (plan 08 §8.6, §8.7, M3-11): one Chromium for the whole run, a 1080 × 1350
// viewport at device scale 1, one page per slide built with `renderSlideHtml` (the same HTML as
// the live preview), fit-text finished before the shot, then PNG → JPEG q90 4:4:4 sRGB. A missing
// glyph stops the run before any browser starts.

export type RenderInputSlide = { slide: SlideData; assets: RenderAssets };

export type RenderedSlide = {
  index: number;
  slideId: string;
  templateId: string;
  jpeg: Uint8Array;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
};

export type CarouselRender = {
  /** Empty when the run stopped on a missing glyph. */
  slides: RenderedSlide[];
  qa: QaReport;
  verdict: QaVerdict;
};

export type RenderOptions = {
  /** Default: a local Chrome on a Mac, else Playwright's own Chromium. */
  executablePath?: string;
  /** Test hook: a browser that is already running (it is not closed). */
  browser?: Browser;
};

const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * The browser binary to use. `explicit` comes from the caller (the job reads it from the env);
 * without one, a local Chrome is used on a Mac, and elsewhere undefined lets Playwright find its
 * own Chromium (CI, cloud sessions: `PLAYWRIGHT_BROWSERS_PATH`).
 */
export function chromiumPath(explicit?: string): string | undefined {
  if (explicit) return explicit;
  return existsSync(MAC_CHROME) ? MAC_CHROME : undefined;
}

export async function launchBrowser(options: RenderOptions = {}): Promise<Browser> {
  const executablePath = chromiumPath(options.executablePath);
  return chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ["--font-render-hinting=none", "--disable-lcd-text", "--force-color-profile=srgb"],
  });
}

/** Text of every slot with the font its template gives it: input of the glyph check. */
export function slotTexts(slides: readonly SlideData[]): SlotText[] {
  return slides.flatMap((slide) => {
    const template = registry.get(slide.templateId);
    return Object.entries(slide.slots).map(([slot, text]) => ({
      slideId: slide.id,
      slot,
      text,
      font: template?.textSlots[slot]?.font ?? "body",
    }));
  });
}

/**
 * Browser-side measurement, as source text: it runs in the page, and the Node build has no DOM
 * types. It is called with the logo's expectation and the safe margin.
 */
const MEASURE_SOURCE = `(expected, marginPx) => {
  const num = (el, name) => Number(el.getAttribute(name) || 0);
  const overflow = [...document.querySelectorAll('[data-overflow="true"]')].map((el) => ({
    slot: el.getAttribute("data-slot") || "",
    fontPxUsed: num(el, "data-font-px"),
  }));
  // A slot that left the safe area or runs into the logo overflows the layout, even if its own
  // box is fine: the text of the slide must not collide with the margin or the logo.
  const logoBox = document.querySelector("[data-logo]");
  const lr = logoBox ? logoBox.getBoundingClientRect() : null;
  for (const el of document.querySelectorAll("[data-slot]")) {
    if (overflow.some((o) => o.slot === el.getAttribute("data-slot"))) continue;
    const r = el.getBoundingClientRect();
    const out = r.left < marginPx - 1 || r.right > 1080 - marginPx + 1 || r.top < marginPx - 1 || r.bottom > 1350 - marginPx + 1;
    const hitsLogo = lr && r.left < lr.right && r.right > lr.left && r.top < lr.bottom && r.bottom > lr.top;
    if (out || hitsLogo) overflow.push({ slot: el.getAttribute("data-slot") || "", fontPxUsed: num(el, "data-font-px") });
  }
  const missingRequiredImages = [
    ...document.querySelectorAll('[data-image-missing][data-required="true"]'),
  ].map((el) => el.getAttribute("data-image") || "");
  const brokenImages = [...document.querySelectorAll("img[data-image]")]
    .filter((img) => !img.complete || img.naturalWidth === 0)
    .map((img) => img.getAttribute("data-image") || "");
  const logo = document.querySelector("[data-logo]");
  const box = logo ? logo.getBoundingClientRect() : null;
  return {
    overflow,
    missingRequiredImages,
    brokenImages,
    logo: {
      box: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
      expected,
      marginPx,
    },
  };
}`;

type Measured = Omit<PageMeasurement, "slideId">;

export async function renderCarousel(
  input: { slides: readonly RenderInputSlide[]; theme: Theme },
  options: RenderOptions = {},
): Promise<CarouselRender> {
  const started = Date.now();
  const slideData = input.slides.map((s) => s.slide);

  // Glyph coverage first: nothing is drawn with a font that lacks a character.
  const missing = findMissingGlyphs(slotTexts(slideData), input.theme.fonts);
  if (missing.length > 0) {
    const qa = buildQaReport({
      measurements: [],
      files: [],
      missingGlyphs: missing,
      durationMs: Date.now() - started,
    });
    return {
      slides: [],
      qa,
      verdict: judgeQa(qa, { missingRequiredImages: [], brokenImages: [] }),
    };
  }

  const browser = options.browser ?? (await launchBrowser(options));
  const rendered: RenderedSlide[] = [];
  const measurements: PageMeasurement[] = [];
  const missingImages: { slideId: string; slot: string }[] = [];
  const brokenImages: { slideId: string; slot: string }[] = [];
  try {
    const context = await browser.newContext({
      viewport: { width: EXPECTED.width, height: EXPECTED.height },
      deviceScaleFactor: 1,
      colorScheme: "light",
    });
    try {
      for (const [i, { slide, assets }] of input.slides.entries()) {
        const template = registry.get(slide.templateId);
        if (!template) throw new Error(`Unknown template "${slide.templateId}".`);
        const html = renderSlideHtml({
          slide,
          theme: input.theme,
          assets,
          page: { index: i + 1, count: input.slides.length },
        });
        const page = await context.newPage();
        try {
          await page.setContent(html, { waitUntil: "load" });
          await page.waitForSelector("html[data-fit-done]", { timeout: 15_000 });
          const logoHeight = Math.max(template.logo.heightPx, input.theme.logo.minHeightPx);
          const measured = (await page.evaluate(
            `(${MEASURE_SOURCE})(${JSON.stringify({ anchor: template.logo.anchor, heightPx: logoHeight })}, ${input.theme.safeMarginPx})`,
          )) as Measured;
          measurements.push({ slideId: slide.id, ...measured });
          for (const slot of measured.missingRequiredImages)
            missingImages.push({ slideId: slide.id, slot });
          for (const slot of measured.brokenImages) brokenImages.push({ slideId: slide.id, slot });

          const png = await page.screenshot({ type: "png", fullPage: false });
          let jpeg = await toJpeg(png, 90);
          // Size guard (08 §8.6): one re-encode at q85 when the file is too large.
          if (jpeg.data.byteLength > MAX_JPEG_BYTES) jpeg = await toJpeg(png, 85);
          rendered.push({
            index: i,
            slideId: slide.id,
            templateId: slide.templateId,
            jpeg: new Uint8Array(jpeg.data),
            width: jpeg.width,
            height: jpeg.height,
            bytes: jpeg.data.byteLength,
            sha256: createHash("sha256").update(jpeg.data).digest("hex"),
          });
        } finally {
          await page.close();
        }
      }
    } finally {
      await context.close();
    }
  } finally {
    if (!options.browser) await browser.close();
  }

  const qa = buildQaReport({
    measurements,
    files: rendered,
    missingGlyphs: [],
    durationMs: Date.now() - started,
  });
  return {
    slides: rendered,
    qa,
    verdict: judgeQa(qa, { missingRequiredImages: missingImages, brokenImages }),
  };
}

async function toJpeg(png: Buffer, quality: number) {
  const { data, info } = await sharp(png)
    .toColourspace("srgb")
    .jpeg({ quality, chromaSubsampling: "4:4:4" })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
