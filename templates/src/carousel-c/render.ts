import { escapeHtml, imageSlot, textSlot } from "../framework/html";
import type { TemplateRenderer } from "../framework/types";

// Template C, before vs after (plan 08 §8.2.1, P1): two stacked pictures with a label on each and
// a caption below. The slots are 8:5; the boxes are a little wider so that both fit above the caption.

export const rendererC: TemplateRenderer = {
  css: `.c-wrap{position:absolute;left:var(--rc-safe-margin);right:var(--rc-safe-margin);top:var(--rc-safe-margin);bottom:calc(var(--rc-safe-margin) + 48px + 28px);display:flex;flex-direction:column;gap:24px}
.c-half{position:relative;height:430px;border-radius:28px;overflow:hidden;flex:none}
.c-half .img{width:100%;height:100%}
.c-pill{position:absolute;left:24px;top:24px;max-width:calc(100% - 48px);padding:10px 26px;border-radius:999px;background:var(--rc-text);color:var(--rc-bg)}
.c-half.after .c-pill{background:var(--rc-accent);color:#fff}
.c-caption{margin-top:auto}`,
  body: (c) => {
    const half = (side: "before" | "after") =>
      `<div class="c-half ${escapeHtml(side)}">${imageSlot(c, side)}<div class="c-pill">${textSlot(c, `${side}Label`, "c-label")}</div></div>`;
    return `<div class="c-wrap">
${half("before")}
${half("after")}
${textSlot(c, "caption", "c-caption")}
</div>`;
  },
};
