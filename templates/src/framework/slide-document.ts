import { rendererA } from "../carousel-a/render";
import { rendererB } from "../carousel-b/render";
import { rendererE } from "../carousel-e/render";
import { rendererF } from "../carousel-f/render";
import type { TemplateDefinition } from "../define-template";
import { fontFaceCss } from "../fonts";
import { registry } from "../registry";
import { cssVariablesText, type Theme } from "../theme";
import { FIT_TEXT_SCRIPT } from "./fit-text";
import { CANVAS, escapeHtml } from "./html";
import type { RenderAssets, RenderContext, SlideData, TemplateRenderer } from "./types";

// The slide document (plan 08 §8.2, §8.6, M3-07): one self-contained HTML page of 1080 × 1350 px
// with inline CSS, fonts and images as data URLs and the fit-text script. The renderer (M3-11)
// and the live preview route (M3-13) both build their pages with `renderSlideHtml`, so what the
// person sees is what is exported.

/** Template id → renderer. M3-10 adds C and D. */
export const TEMPLATE_RENDERERS: Readonly<Record<string, TemplateRenderer>> = {
  A: rendererA,
  B: rendererB,
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

const BASE_CSS = `*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${CANVAS.width}px;height:${CANVAS.height}px;background:#fff;overflow:hidden}
.rc-slide{position:relative;width:${CANVAS.width}px;height:${CANVAS.height}px;overflow:hidden;background:var(--rc-bg);color:var(--rc-text);font-family:var(--rc-font-body);-webkit-font-smoothing:antialiased;hyphens:none;-webkit-hyphens:none;font-kerning:normal;text-rendering:geometricPrecision}
.slot{overflow:hidden;overflow-wrap:break-word;word-break:normal}
.slot.display{font-family:var(--rc-font-display);line-height:1.12;text-wrap:balance;font-weight:600}
.slot.body{font-family:var(--rc-font-body);line-height:1.3;font-weight:400}
.img{display:block;object-fit:cover}
.img-missing{background:repeating-linear-gradient(45deg,#e8e2d8,#e8e2d8 12px,#f4f0e8 12px,#f4f0e8 24px)}
.rc-logo{position:absolute;display:flex;align-items:center;font-family:var(--rc-font-display);font-weight:700;letter-spacing:.02em;color:var(--rc-text)}
.rc-logo img{display:block;height:100%;width:auto}
.rc-page{position:absolute;right:var(--rc-safe-margin);bottom:var(--rc-safe-margin);font-family:var(--rc-font-body);font-size:24px;line-height:1;color:var(--rc-text);opacity:.6}`;

export function renderSlideHtml(input: RenderSlideInput): string {
  const { slide, theme, assets, page } = input;
  const template = (input.templates ?? registry).get(slide.templateId);
  if (!template) throw new Error(`Unknown template "${slide.templateId}".`);
  const renderer = (input.renderers ?? TEMPLATE_RENDERERS)[slide.templateId];
  if (!renderer) throw new Error(`Template ${slide.templateId} has no renderer yet.`);

  const context: RenderContext = { slide, template, theme, assets, page };
  const logoHeight = Math.max(template.logo.heightPx, theme.logo.minHeightPx);
  const logo = assets.logo
    ? `<div class="rc-logo" data-logo style="${LOGO_ANCHORS[template.logo.anchor]}height:${logoHeight}px"><img alt="" src="${assets.logo}"></div>`
    : `<div class="rc-logo" data-logo style="${LOGO_ANCHORS[template.logo.anchor]}height:${logoHeight}px;font-size:${Math.round(logoHeight * 0.6)}px">Reg.Chef</div>`;
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
<div class="rc-slide" data-slide-id="${escapeHtml(slide.id)}" data-template="${escapeHtml(template.id)}" style="${cssVariablesText(theme)}">
${renderer.body(context)}
${logo}
<div class="rc-page" data-page>${page.index}/${page.count}</div>
</div>
<script>${FIT_TEXT_SCRIPT}</script>
</body>
</html>
`;
}
