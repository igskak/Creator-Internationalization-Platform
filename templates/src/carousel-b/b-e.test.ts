import { describe, expect, it } from "vitest";
import { TEMPLATE_FIXTURES } from "../fixtures";
import { renderSlideHtml } from "../framework/slide-document";
import { registry } from "../registry";
import { buildTheme } from "../theme";
import { validateSlideAgainstTemplate } from "../validate";

// HTML snapshots of templates B and E for every fixture (08 §8.9); the pixel checks come with the
// renderer (M3-11) and the golden images (M3-14).

const PICTURE = "data:image/webp;base64,UklGRg==";
const stripFonts = (html: string) =>
  html.replace(/data:font\/woff2;base64,[A-Za-z0-9+/=]+/g, "data:font/woff2;base64,…");

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
  it("has a mistake panel and a correct panel, and the picture only when there is one", () => {
    const html = render("E", "es-long");
    expect(html).toContain('<div class="e-panel mistake">');
    expect(html).toContain('<div class="e-panel correct">');
    expect(html).toContain('data-image="image"');
    expect(render("E", "es-long", false)).not.toContain('data-image="image"');
  });
});
