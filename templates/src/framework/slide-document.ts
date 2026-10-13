import { rendererA } from "../carousel-a/render";
import { rendererB } from "../carousel-b/render";
import { rendererC } from "../carousel-c/render";
import { rendererD } from "../carousel-d/render";
import { rendererE } from "../carousel-e/render";
import { rendererF } from "../carousel-f/render";
import type { TemplateDefinition } from "../define-template";
import { fontFaceCss } from "../fonts";
import { registry } from "../registry";
import { cssVariablesText, type Theme } from "../theme";
import { FIT_TEXT_SCRIPT } from "./fit-text";
import { CANVAS, escapeHtml, LINE_HEIGHT } from "./html";
import type { RenderAssets, RenderContext, SlideData, TemplateRenderer } from "./types";

// The slide document (plan 08 §8.2, §8.6, M3-07): one self-contained HTML page of 1080 × 1350 px
// with inline CSS, fonts and images as data URLs and the fit-text script. The renderer (M3-11)
// and the live preview route (M3-13) both build their pages with `renderSlideHtml`, so what the
// person sees is what is exported.

/** Template id → renderer. all six templates. */
export const TEMPLATE_RENDERERS: Readonly<Record<string, TemplateRenderer>> = {
  A: rendererA,
  B: rendererB,
  C: rendererC,
  D: rendererD,
  E: rendererE,
  F: rendererF,
};

export type RenderSlideInput = {
  slide: SlideData;
  theme: Theme;
  assets: RenderAssets;
  page: { index: number; count: number };
  /** Test hook: renderers other than the registered ones. */
  renderers?: Readonly<Record<string, TemplateRenderer>>;
  /** Test hook: templates other than the registry. */
  templates?: { get(id: string): Readonly<TemplateDefinition> | undefined };
};

const LOGO_ANCHORS: Record<TemplateDefinition["logo"]["anchor"], string> = {
  "top-left": "top:var(--rc-safe-margin);left:var(--rc-safe-margin);",
  "top-right": "top:var(--rc-safe-margin);right:var(--rc-safe-margin);",
  "bottom-left": "bottom:var(--rc-safe-margin);left:var(--rc-safe-margin);",
  "bottom-right": "bottom:var(--rc-safe-margin);right:var(--rc-safe-margin);",
};

// Shared look (docs/design/carousel-style.md): white page, uppercase extra-bold headlines, light
// body with bold emphasis, a tiny footer. `--rc-muted` is a grey that still has 4.5:1 on white.
const BASE_CSS = `*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${CANVAS.width}px;height:${CANVAS.height}px;background:#fff;overflow:hidden}
.rc-slide{--rc-muted:color-mix(in srgb,var(--rc-text) 60%,var(--rc-bg));position:relative;width:${CANVAS.width}px;height:${CANVAS.height}px;overflow:hidden;background:var(--rc-bg);color:var(--rc-text);font-family:var(--rc-font-body);-webkit-font-smoothing:antialiased;hyphens:none;-webkit-hyphens:none;font-kerning:normal;text-rendering:geometricPrecision}
.slot{flex:none;overflow:hidden;overflow-wrap:break-word;word-break:normal;position:relative;z-index:1}
.slot.display{font-family:var(--rc-font-display);line-height:${LINE_HEIGHT.display};padding-block:.1em;text-wrap:balance;font-weight:800;text-transform:uppercase;letter-spacing:-.02em}
.slot.body{font-family:var(--rc-font-body);line-height:${LINE_HEIGHT.body};padding-block:.06em;font-weight:300}
.slot em{font-style:normal}
.slot.body em{font-weight:700}
.slot.display em{color:var(--rc-accent)}
.slot.rc-kicker{font-family:var(--rc-font-body);font-weight:600;text-transform:uppercase;letter-spacing:.14em;text-wrap:wrap}
.img{display:block;object-fit:cover}
.img.cutout{position:absolute;left:0;top:0;width:${CANVAS.width}px;height:${CANVAS.height}px;z-index:0;mix-blend-mode:multiply}
.img.cutout.place-top-right{transform:translate(110px,-30px)}
.img.cutout.place-right-column{transform:translate(110px,0)}
.img.cutout.place-bottom-band{transform:translate(40px,170px)}
.img-missing{background:repeating-linear-gradient(45deg,#ececec,#ececec 12px,#f6f6f6 12px,#f6f6f6 24px)}
.rc-logo{position:absolute;display:flex;align-items:center;z-index:2}
.rc-logo img{display:block;height:100%;width:auto}
.rc-handle,.rc-page{position:absolute;bottom:44px;z-index:2;font-family:var(--rc-font-body);font-size:22px;line-height:1;letter-spacing:.02em;font-weight:400;text-shadow:0 0 3px var(--rc-bg),0 0 8px var(--rc-bg),0 0 14px var(--rc-bg)}
.rc-handle{left:var(--rc-safe-margin);color:var(--rc-text)}
.rc-page{right:var(--rc-safe-margin);color:var(--rc-muted)}`;

export function renderSlideHtml(input: RenderSlideInput): string {
  const { slide, theme, assets, page } = input;
  const template = (input.templates ?? registry).get(slide.templateId);
  if (!template) throw new Error(`Unknown template "${slide.templateId}".`);
  const renderer = (input.renderers ?? TEMPLATE_RENDERERS)[slide.templateId];
  if (!renderer) throw new Error(`Template ${slide.templateId} has no renderer yet.`);

  const context: RenderContext = { slide, template, theme, assets, page };
  const logoHeight = Math.max(template.logo.heightPx, theme.logo.minHeightPx);
  // The accounts are independent: without a logo of the brand theme the corner stays empty.
  const logo = assets.logo
    ? `<div class="rc-logo" data-logo style="${LOGO_ANCHORS[template.logo.anchor]}height:${logoHeight}px"><img alt="" src="${assets.logo}"></div>`
    : assets.handle
      ? `<div class="rc-handle" data-handle>@${escapeHtml(assets.handle.replace(/^@/, ""))}</div>`
      : "";
  const fonts = [...new Set([theme.fonts.display, theme.fonts.body])].map(fontFaceCss).join("\n");

  return `<!doctype html>
<html lang="en" data-template="${escapeHtml(template.id)}" data-template-version="${escapeHtml(template.version)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${CANVAS.width},initial-scale=1">
<style>
${fonts}
${BASE_CSS}
${renderer.css}
</style>
</head>
<body>
<div class="rc-slide" data-slide-id="${escapeHtml(slide.id)}" data-template="${escapeHtml(template.id)}" style="${escapeHtml(cssVariablesText(theme))}">
${renderer.body(context)}
${logo}
<div class="rc-page" data-page>${page.index}/${page.count}</div>${assets.aiBadge ? `<div class="rc-ai-badge" data-ai-badge style="position:absolute;right:var(--rc-safe-margin);top:var(--rc-safe-margin);font-family:var(--rc-font-body);z-index:2;font-size:22px;font-weight:700;line-height:1;letter-spacing:.06em;color:#fff;background:rgba(20,20,20,.72);padding:8px 14px;border-radius:999px">AI</div>` : ""}
</div>
<script>${FIT_TEXT_SCRIPT}</script>
</body>
</html>
`;
}
