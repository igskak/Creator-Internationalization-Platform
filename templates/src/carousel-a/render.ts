import { imageSlot, textSlot } from "../framework/html";
import type { TemplateRenderer } from "../framework/types";

// Template A, hero ingredient + strong hook (plan 08 §8.2.1). Dark cover (default): the picture
// fills the canvas, a dark gradient rises from the bottom, and kicker, headline and subline sit in
// white above the footer; the headline's emphasis is drawn in the accent colour (large text: 3:1
// is enough over the shade). White cover (the brand's `visual_system.cover`, carousel v3 D1): the
// page of the inner slides, the text top left in ink and the picture as a cut-out fitted beside it
// by its measured subject, so the grid reads as one series.

export const rendererA: TemplateRenderer = {
  css: `.a-hero{position:absolute;inset:0;width:100%;height:100%}
.a-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 34%,rgba(0,0,0,.55) 55%,rgba(0,0,0,.9) 100%)}
.a-text{position:absolute;left:var(--rc-safe-margin);right:var(--rc-safe-margin);bottom:120px;display:flex;flex-direction:column;gap:24px;color:#fff;z-index:1}
.a-kicker{opacity:.9}
.a-sub{opacity:.9}
[data-template="A"] .rc-handle,[data-template="A"] .rc-page{color:rgba(255,255,255,.85);text-shadow:none}
.a-white .a-text{top:120px;bottom:auto;right:auto;width:600px;color:var(--rc-text);gap:26px}
.a-white .a-kicker{opacity:1;color:var(--rc-muted)}
.a-white .a-sub{opacity:1;width:468px}
.a-white .a-cut{transform:translate(200px,300px)}
.a-white ~ .rc-handle{color:var(--rc-text);text-shadow:0 0 3px var(--rc-bg),0 0 8px var(--rc-bg),0 0 14px var(--rc-bg)}
.a-white ~ .rc-page{color:var(--rc-muted);text-shadow:0 0 3px var(--rc-bg),0 0 8px var(--rc-bg),0 0 14px var(--rc-bg)}`,
  body: (c) => {
    const text = `<div class="a-text">
${textSlot(c, "kicker", "rc-kicker a-kicker")}
${textSlot(c, "headline", "a-headline")}
${textSlot(c, "subline", "a-sub")}
</div>`;
    if (c.theme.cover === "white") {
      return `<div class="a-white">
${imageSlot(c, "hero", "cutout a-cut", ' data-place="cover"')}
${text}
</div>`;
    }
    return `${imageSlot(c, "hero", "a-hero")}
<div class="a-shade"></div>
${text}`;
  },
};
