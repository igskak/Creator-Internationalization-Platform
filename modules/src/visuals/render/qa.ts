import type { QaReport, VariantFlag } from "@rc/db/json";

// Render QA (plan 08 §8.6, §8.7, M3-11): what the page and the files are checked for, and what the
// findings mean for the variant's flags. Pure: the browser measures, this decides.

export const EXPECTED = { width: 1080, height: 1350 } as const;
/** Largest JPEG the publishing API accepts is 8 MB (V-05); the target is far below it. */
export const MAX_JPEG_BYTES = 8 * 1024 * 1024;
export const LOGO_TOLERANCE_PX = 2;

/** WCAG contrast of text over its background; below this the slot is reported (08 §8.6, P1). */
export const MIN_CONTRAST = 4.5;

/** Relative luminance of an sRGB colour (WCAG 2.x). */
export function luminance(r: number, g: number, b: number): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio of two colours, 1–21. */
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(...a);
  const lb = luminance(...b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The worst contrast of a text colour over the pixels of its box: the 5th percentile of the ratios
 * over a grid of pixels, so a few stray pixels of the picture do not decide. `pixels` is raw RGB(A).
 */
export function worstContrast(
  text: [number, number, number],
  box: { x: number; y: number; width: number; height: number },
  image: { data: Uint8Array; width: number; height: number; channels: number },
  step = 4,
): number {
  const ratios: number[] = [];
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(image.width, Math.ceil(box.x + box.width));
  const y1 = Math.min(image.height, Math.ceil(box.y + box.height));
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * image.width + x) * image.channels;
      ratios.push(
        contrastRatio(text, [image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0]),
      );
    }
  }
  if (ratios.length === 0) return 21;
  ratios.sort((a, b) => a - b);
  return ratios[Math.floor(ratios.length * 0.05)] ?? 21;
}

/** What the browser measured on one slide. */
export type PageMeasurement = {
  slideId: string;
  /** `[data-overflow]` elements after fit-text. */
  overflow: { slot: string; fontPxUsed: number }[];
  /** Required image slots with no picture (`[data-image-missing][data-required=true]`). */
  missingRequiredImages: string[];
  /** Pictures that did not load (`img.complete` false or zero width). */
  brokenImages: string[];
  /** Text slots with their box and colour, for the contrast check. */
  slots: {
    slot: string;
    box: { x: number; y: number; width: number; height: number };
    color: [number, number, number];
  }[];
  /** The logo's box and what the template asked for. */
  logo: {
    box: { x: number; y: number; width: number; height: number } | null;
    expected: {
      anchor: "top-left" | "top-right" | "bottom-left" | "bottom-right";
      heightPx: number;
    };
    marginPx: number;
  };
};

export function logoPlacementOk(logo: PageMeasurement["logo"]): boolean {
  const { box, expected, marginPx } = logo;
  if (!box) return false;
  const tol = LOGO_TOLERANCE_PX;
  const near = (a: number, b: number) => Math.abs(a - b) <= tol;
  const horizontal = expected.anchor.endsWith("left")
    ? near(box.x, marginPx)
    : near(box.x + box.width, EXPECTED.width - marginPx);
  const vertical = expected.anchor.startsWith("top")
    ? near(box.y, marginPx)
    : near(box.y + box.height, EXPECTED.height - marginPx);
  return horizontal && vertical && near(box.height, expected.heightPx);
}

export type SlideFiles = { width: number; height: number; bytes: number };

/** The `QaReport` of a render. */
export function buildQaReport(args: {
  measurements: readonly PageMeasurement[];
  files: readonly SlideFiles[];
  missingGlyphs: QaReport["missingGlyphs"];
  durationMs: number;
  lowContrast?: NonNullable<QaReport["lowContrast"]>;
}): QaReport {
  return {
    ...(args.lowContrast && args.lowContrast.length > 0 ? { lowContrast: args.lowContrast } : {}),
    overflow: args.measurements.flatMap((m) =>
      m.overflow.map((o) => ({ slideId: m.slideId, slot: o.slot, fontPxUsed: o.fontPxUsed })),
    ),
    missingGlyphs: [...args.missingGlyphs],
    dimensionsOk: args.files.every(
      (f) => f.width === EXPECTED.width && f.height === EXPECTED.height,
    ),
    logoPlacementOk: args.measurements.every((m) => logoPlacementOk(m.logo)),
    fileSizes: args.files.map((f) => f.bytes),
    durationMs: args.durationMs,
  };
}

export type QaVerdict = {
  /** Findings that do not block: low contrast (08 §8.6, P1). */
  warnings: string[];
  /** The render may be used for review and approval. */
  ok: boolean;
  /** Flags this render sets on the variant (the caller clears the ones it no longer sets). */
  flags: VariantFlag[];
  problems: string[];
};

/** Blocking findings → the flags of 04 §4.4 (TEXT_OVERFLOW, MISSING_GLYPH, RENDER_FAILED, VISUAL_MISSING). */
export function judgeQa(
  report: QaReport,
  extra: {
    missingRequiredImages: readonly { slideId: string; slot: string }[];
    brokenImages: readonly { slideId: string; slot: string }[];
  },
): QaVerdict {
  const flags = new Set<VariantFlag>();
  const problems: string[] = [];
  if (report.overflow.length > 0) {
    flags.add("TEXT_OVERFLOW");
    problems.push(
      `Text overflows: ${report.overflow.map((o) => `${o.slideId}/${o.slot}`).join(", ")}.`,
    );
  }
  if (report.missingGlyphs.length > 0) {
    flags.add("MISSING_GLYPH");
    problems.push(
      `Missing glyphs: ${report.missingGlyphs.map((g) => `${g.slideId}/${g.slot} ${g.chars.join("")}`).join(", ")}.`,
    );
  }
  if (extra.missingRequiredImages.length > 0) {
    flags.add("VISUAL_MISSING");
    problems.push(
      `Required picture missing: ${extra.missingRequiredImages.map((m) => `${m.slideId}/${m.slot}`).join(", ")}.`,
    );
  }
  if (extra.brokenImages.length > 0) {
    flags.add("RENDER_FAILED");
    problems.push(
      `A picture did not load: ${extra.brokenImages.map((m) => `${m.slideId}/${m.slot}`).join(", ")}.`,
    );
  }
  if (!report.dimensionsOk) {
    flags.add("RENDER_FAILED");
    problems.push(`A slide is not ${EXPECTED.width} × ${EXPECTED.height}.`);
  }
  if (!report.logoPlacementOk) {
    flags.add("RENDER_FAILED");
    problems.push("The logo is not where the template puts it.");
  }
  if (report.fileSizes.some((bytes) => bytes > MAX_JPEG_BYTES)) {
    flags.add("RENDER_FAILED");
    problems.push("A slide is larger than 8 MB.");
  }
  const warnings = (report.lowContrast ?? []).map(
    (c) =>
      `Low contrast ${c.ratio.toFixed(1)}:1 (needs ${MIN_CONTRAST}:1): ${c.slideId}/${c.slot}.`,
  );
  return { ok: flags.size === 0, flags: [...flags], problems, warnings };
}
