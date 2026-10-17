import { describe, expect, it } from "vitest";
import { TEMPLATE_FIXTURES } from "../fixtures";
import { renderSlideHtml } from "../framework/slide-document";
import type { SlideData } from "../framework/types";
import { registry } from "../registry";
import { buildTheme } from "../theme";
import { validateSlideAgainstTemplate } from "../validate";

// HTML snapshots of templates B and E for every fixture (08 §8.9); the pixel checks come with the
// renderer (M3-11) and the golden images (M3-14).

const PICTURE = "data:image/webp;base64,UklGRg==";
/** Fonts are megabytes of base64 and the page scripts are snapshotted once in the framework test. */
const stripFonts = (html: string) =>
  html
    .replace(/data:font\/woff2;base64,[A-Za-z0-9+/=]+/g, "data:font/woff2;base64,…")
    .replace(/<script>[\s\S]*?<\/script>/g, "<script>…</script>");

const render = (templateId: string, name: string, withImages = true) => {
  const slide = TEMPLATE_FIXTURES[templateId]?.[name];
  if (!slide) throw new Error("no fixture");
  const spec = registry.get(templateId);
  const images: Record<string, string> = {};
  if (withImages) for (const slot of Object.keys(spec?.imageSlots ?? {})) images[slot] = PICTURE;
  return renderSlideHtml({
    slide,
    theme: buildTheme({}),
    assets: { images },
    page: { index: 1, count: 6 },
  });
};

describe.each(["B", "E"])("template %s", (id) => {
  const names = Object.keys(TEMPLATE_FIXTURES[id] ?? {});

  it("has the five fixtures of 08 §8.9", () => {
    expect(names).toEqual([
      "es-long",
      "en-short",
      "max-length",
      "special-chars",
      id === "B" ? "no-number" : "no-optionals",
    ]);
  });

  it.each(names)("fixture %s is valid for the template and renders a stable page", (name) => {
    const slide = TEMPLATE_FIXTURES[id]?.[name];
    const issues = validateSlideAgainstTemplate(slide as never);
    expect(issues.filter((i) => i.severity === "BLOCKER")).toEqual([]);
    expect(stripFonts(render(id, name))).toMatchSnapshot();
  });

  it("uses the template's own slots only, with fit-text bounds from its metadata", () => {
    const html = render(id, "es-long");
    const spec = registry.get(id);
    for (const [slot, s] of Object.entries(spec?.textSlots ?? {})) {
      const marker = `data-slot="${slot}" data-fit data-fit-min="${s.minPx}" data-fit-max="${s.maxPx}"`;
      if ((TEMPLATE_FIXTURES[id]?.["es-long"]?.slots[slot] ?? "").trim())
        expect(html).toContain(marker);
    }
  });
});

describe("template B", () => {
  it("opens with the number and its label when there is one", () => {
    const html = render("B", "es-long");
    expect(html).toContain('data-slot="number"');
    expect(html).toContain('data-slot="label"');
    expect(html).toContain('data-image="side"');
  });

  it("is a headline + body slide without a number", () => {
    const html = render("B", "no-number", false);
    expect(html).not.toContain('data-slot="number"');
    expect(html).not.toContain('data-slot="label"');
    expect(html).not.toContain('data-image="side"');
    expect(html).toContain('data-slot="headline"');
    expect(html).toContain('data-slot="body"');
  });
});

describe("template E", () => {
  it("strikes out the mistake, then the correct way, and the cut-out only when there is one", () => {
    const html = render("E", "es-long");
    expect(html).toContain('class="slot display e-mistake-title" data-slot="mistakeTitle"');
    expect(html).toContain('class="slot display e-correct-title" data-slot="correctTitle"');
    expect(html).toContain('<img class="img cutout e-photo" data-image="image"');
    expect(render("E", "es-long", false)).not.toContain('data-image="image"');
  });
});

describe("template B number", () => {
  it("draws a step number in ink and any other figure in the accent colour", () => {
    expect(render("B", "en-short")).toContain('class="slot display b-number" data-slot="number"');
    expect(render("B", "es-long")).toContain(
      'class="slot display b-number figure" data-slot="number"',
    );
  });

  it("narrows the column only when there is a picture", () => {
    expect(render("B", "es-long")).toContain('<div class="b-wrap has-photo">');
    expect(render("B", "es-long", false)).toContain('<div class="b-wrap">');
  });

  it("hands the placement to the placement script instead of narrowing the column", () => {
    const placed = (placement: string) =>
      renderSlideHtml({
        slide: TEMPLATE_FIXTURES.B?.["es-long"] as never,
        theme: buildTheme({}),
        assets: { images: { side: PICTURE }, placements: { side: placement } },
        page: { index: 1, count: 6 },
      });
    expect(placed("RIGHT_COLUMN")).toContain('<div class="b-wrap has-photo">');
    expect(placed("RIGHT_COLUMN")).toContain(
      'class="img cutout b-photo place-right-column" data-image="side" data-place="right-column"',
    );
    expect(placed("BOTTOM_BAND")).toContain('data-place="bottom-band"');
  });
});

describe("template B, carousel v3 text", () => {
  const withSlots = (slots: Record<string, string>) =>
    renderSlideHtml({
      slide: { ...(TEMPLATE_FIXTURES.B?.["es-long"] as SlideData), slots },
      theme: buildTheme({}),
      assets: { images: {} },
      page: { index: 1, count: 6 },
    });

  it("draws a ladder: one line per sentence, a half-line gap between groups", () => {
    const html = withSlots({ body: "Rinse it.\nDrain it.\n\n\nThen cook." });
    expect(html).toContain('Rinse it.<br>Drain it.<span class="gap"></span>Then cook.');
  });

  it("draws the lead quieter than the headline and the closer in bold", () => {
    const html = withSlots({
      lead: "Boil it uncovered,",
      headline: "then lid on.",
      body: "x",
      closer: "Keep it shut.",
    });
    expect(html).toContain('class="slot display lead b-lead"');
    expect(html).toContain('class="slot display closer b-closer"');
  });

  it("draws a step label with its digits in ink, any other figure in the accent colour", () => {
    expect(withSlots({ number: "Step 2", body: "x" })).toContain('class="slot display b-number"');
    expect(withSlots({ number: "Paso 3", body: "x" })).toContain('class="slot display b-number"');
    expect(withSlots({ number: "1:2", body: "x" })).toContain(
      'class="slot display b-number figure"',
    );
  });
});
