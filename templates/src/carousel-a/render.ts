import { imageSlot, textSlot } from "../framework/html";
import type { TemplateRenderer } from "../framework/types";

// Template A, hero ingredient + strong hook (plan 08 §8.2.1): the picture fills the canvas, a dark
// gradient rises from the bottom, and kicker, headline and subline sit in white above the footer.
// The headline's emphasis is drawn in the accent colour (large text: 3:1 is enough over the shade).

export const rendererA: TemplateRenderer = {
  css: `.a-hero{position:absolute;inset:0;width:100%;height:100%}
.a-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 34%,rgba(0,0,0,.55) 55%,rgba(0,0,0,.9) 100%)}
.a-text{position:absolute;left:var(--rc-safe-margin);right:var(--rc-safe-margin);bottom:120px;display:flex;flex-direction:column;gap:24px;color:#fff;z-index:1}
.a-kicker{opacity:.9}
.a-sub{opacity:.9}
[data-template="A"] .rc-handle,[data-template="A"] .rc-page{color:rgba(255,255,255,.85);text-shadow:none}`,
  body: (c) =>
    `${imageSlot(c, "hero", "a-hero")}
<div class="a-shade"></div>
<div class="a-text">
${textSlot(c, "kicker", "rc-kicker a-kicker")}
${textSlot(c, "headline", "a-headline")}
${textSlot(c, "subline", "a-sub")}
</div>`,
};
