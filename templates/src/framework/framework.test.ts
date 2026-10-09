import { describe, expect, it } from "vitest";
import { registry } from "../registry";
import { buildTheme } from "../theme";
import { FIT_TEXT_SCRIPT } from "./fit-text";
import { imageSlot, slotBoxHeightPx, textSlot } from "./html";
import { renderSlideHtml, TEMPLATE_RENDERERS } from "./slide-document";
import type { RenderContext, SlideData, TemplateRenderer } from "./types";

// A stub renderer for template A stands in until M3-08 adds the real ones.
const stub: TemplateRenderer = {
  css: ".stub{position:absolute;inset:0}",
  body: (c) =>
    `<div class="stub">${imageSlot(c, "hero", "hero")}${textSlot(c, "kicker", "k")}${textSlot(c, "headline", "h")}${textSlot(c, "subline", "s")}</div>`,
};
const slide: SlideData = {
  id: "s1",
  index: 0,
  role: "HOOK",
  templateId: "A",
  slots: { headline: "¿Por qué no lavar el arroz?\nSegunda línea", kicker: "Mito" },
};
const input = {
  slide,
  theme: buildTheme({}),
  assets: { images: { hero: "data:image/webp;base64,AAAA" } },
  page: { index: 1, count: 6 },
  renderers: { A: stub },
};
/** Fonts are megabytes of base64: keep them out of the snapshot. */
const stripFonts = (html: string) =>
  html.replace(/data:font\/woff2;base64,[A-Za-z0-9+/=]+/g, "data:font/woff2;base64,…");

describe("renderSlideHtml", () => {
  it("renders a stable document for a fixture slide", () => {
    expect(stripFonts(renderSlideHtml(input))).toMatchSnapshot();
  });

  it("is deterministic", () => {
    expect(renderSlideHtml(input)).toBe(renderSlideHtml(input));
  });

  it("is self-contained: fonts and images inline, no external reference", () => {
    const html = renderSlideHtml(input);
    expect(html).toContain("@font-face");
    expect(html).toContain("src:url(data:font/woff2;base64,");
    expect(html).not.toMatch(/(?:src|href)="https?:/);
    expect(html).not.toContain("url(http");
    expect(html).toContain("<script>(function () {");
  });

  it("escapes slide text so it cannot open a tag or a script", () => {
    const hostile = { ...slide, slots: { headline: '</div><script>alert(1)</script> & "x"' } };
    const html = renderSlideHtml({ ...input, slide: hostile });
    expect(html).toContain("&lt;/div&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;");
    expect(html.match(/<script>/g)).toHaveLength(1);
  });

  it("puts the logo at the template's anchor, or a text mark without a logo asset", () => {
    expect(renderSlideHtml(input)).toContain(
      "bottom:var(--rc-safe-margin);left:var(--rc-safe-margin);height:48px",
    );
    expect(renderSlideHtml(input)).toContain(">Reg.Chef</div>");
    const withLogo = renderSlideHtml({
      ...input,
      assets: { ...input.assets, logo: "data:image/svg+xml;base64,PHN2Zy8+" },
    });
    expect(withLogo).toContain('<img alt="" src="data:image/svg+xml;base64,PHN2Zy8+">');
  });

  it("shows the page indicator and the theme variables on the root", () => {
    const html = renderSlideHtml(input);
    expect(html).toContain('<div class="rc-page" data-page>1/6</div>');
    expect(html).toContain("--rc-bg:#FAF6EF;");
  });

  it("fails clearly for an unknown template or one without a renderer", () => {
    expect(() => renderSlideHtml({ ...input, slide: { ...slide, templateId: "Z" } })).toThrow(
      'Unknown template "Z"',
    );
    expect(() => renderSlideHtml({ ...input, renderers: {} })).toThrow("has no renderer yet");
    expect(Object.keys(TEMPLATE_RENDERERS).every((id) => registry.get(id))).toBe(true);
  });
});

describe("slot helpers", () => {
  const context: RenderContext = {
    slide,
    template: registry.get("A") as NonNullable<ReturnType<typeof registry.get>>,
    theme: input.theme,
    assets: { images: {} },
    page: { index: 1, count: 6 },
  };

  it("sizes the box from the template's limits and marks the slot for fit-text", () => {
    const html = textSlot(context, "headline", "h");
    // headline: 3 lines × 96 px × 1.12
    expect(slotBoxHeightPx(context.template.textSlots.headline as never)).toBe(323);
    expect(html).toContain('data-slot="headline" data-fit data-fit-min="64" data-fit-max="96"');
    expect(html).toContain("height:323px");
    expect(html).toContain("Por qué no lavar el arroz?<br>Segunda línea");
  });

  it("leaves out an optional slot without text and rejects a slot the template lacks", () => {
    expect(textSlot(context, "subline")).toBe("");
    expect(() => textSlot(context, "nope")).toThrow('no text slot "nope"');
    expect(() => imageSlot(context, "nope")).toThrow('no image slot "nope"');
  });

  it("marks a missing image so the QA can tell a required one", () => {
    expect(imageSlot(context, "hero")).toContain('data-image-missing data-required="true"');
  });
});

describe("fit-text script", () => {
  type Node = {
    attrs: Record<string, string>;
    style: { fontSize: string };
    scrollHeight: number;
    clientHeight: number;
    scrollWidth: number;
    clientWidth: number;
    getAttribute(n: string): string | null;
    setAttribute(n: string, v: string): void;
  };
  /** An element whose text needs `need(size)` px of height in a box of `box` px. */
  const element = (max: number, min: number, box: number, need: (size: number) => number): Node => {
    const el: Node = {
      attrs: { "data-fit-max": String(max), "data-fit-min": String(min) },
      style: { fontSize: "" },
      get scrollHeight() {
        return need(Number.parseFloat(el.style.fontSize));
      },
      clientHeight: box,
      scrollWidth: 100,
      clientWidth: 100,
      getAttribute: (n) => el.attrs[n] ?? null,
      setAttribute: (n, v) => {
        el.attrs[n] = v;
      },
    } as Node;
    return el;
  };
  const run = async (nodes: Node[]) => {
    const root = {
      attrs: {} as Record<string, string>,
      setAttribute(n: string, v: string) {
        this.attrs[n] = v;
      },
    };
    const window: Record<string, unknown> = {};
    const document = {
      querySelectorAll: () => nodes,
      documentElement: root,
      fonts: { ready: Promise.resolve() },
    };
    new Function("document", "window", FIT_TEXT_SCRIPT)(document, window);
    await Promise.resolve();
    await Promise.resolve();
    return root;
  };

  it("lowers the size by 2 px until the text fits", async () => {
    const el = element(96, 64, 300, (size) => size * 3.4); // fits at 88 (299.2)
    const root = await run([el]);
    expect(el.style.fontSize).toBe("88px");
    expect(el.attrs["data-font-px"]).toBe("88");
    expect(el.attrs["data-overflow"]).toBeUndefined();
    expect(root.attrs["data-fit-done"]).toBe("true");
  });

  it("keeps the maximum when the text fits and stops at the minimum with an overflow mark", async () => {
    const fits = element(96, 64, 400, () => 100);
    const tooLong = element(96, 64, 100, () => 500);
    await run([fits, tooLong]);
    expect(fits.style.fontSize).toBe("96px");
    expect(tooLong.style.fontSize).toBe("64px");
    expect(tooLong.attrs["data-overflow"]).toBe("true");
    expect(fits.attrs["data-overflow"]).toBeUndefined();
  });
});
