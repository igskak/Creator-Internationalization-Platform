import { describe, expect, it } from "vitest";
import { TEMPLATE_FIXTURES } from "../fixtures";
import { renderSlideHtml } from "../framework/slide-document";
import { registry } from "../registry";
import { buildTheme } from "../theme";
import { validateSlideAgainstTemplate } from "../validate";

// HTML snapshots of templates C and D for every fixture (08 §8.9); the pixel checks come with the
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

describe.each(["C", "D"])("template %s", (id) => {
  const names = Object.keys(TEMPLATE_FIXTURES[id] ?? {});

  it("has the five fixtures of 08 §8.9", () => {
    expect(names).toEqual(["es-long", "en-short", "max-length", "special-chars", "no-optionals"]);
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

describe("template C", () => {
  it("shows both pictures with their labels and the caption", () => {
    const html = render("C", "es-long");
    expect(html).toContain('data-image="before"');
    expect(html).toContain('data-image="after"');
    expect(html).toContain('data-slot="beforeLabel"');
    expect(html).toContain('data-slot="caption"');
    expect(
      render("C", "es-long", false).match(/data-image-missing data-required="true"/g),
    ).toHaveLength(2);
  });
});

describe("template D", () => {
  it("draws the steps that have text, each with its own icon, in order", () => {
    const html = render("D", "es-long");
    expect(html.match(/data-step="/g)).toHaveLength(5);
    for (const icon of ["water", "heat", "time", "stir", "rest"])
      expect(html).toContain(`data-icon="${icon}"`);
    expect(html).toContain("<svg");
    const three = render("D", "no-optionals");
    expect(three.match(/data-step="/g)).toHaveLength(3);
    expect(three).not.toContain('data-slot="step4"');
  });

  it("shows the optional picture only when there is one", () => {
    expect(render("D", "es-long")).toContain('data-image="image"');
    expect(render("D", "es-long", false)).not.toContain('data-image="image"');
  });
});
