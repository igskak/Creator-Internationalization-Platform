import { imageSlot, textSlot } from "../framework/html";
import type { TemplateRenderer } from "../framework/types";

// Template A, hero ingredient + strong hook (plan 08 §8.2.1): the picture fills the canvas, a dark
// gradient rises from the bottom, and kicker, headline and subline sit above the logo.

export const rendererA: TemplateRenderer = {
  css: `.a-hero{position:absolute;inset:0;width:100%;height:100%}
.a-shade{position:absolute;inset:0;background:linear-gradient(to top,rgba(14,10,6,.82) 0%,rgba(14,10,6,.55) 38%,rgba(14,10,6,0) 68%)}
.a-text{position:absolute;left:var(--rc-safe-margin);right:var(--rc-safe-margin);bottom:calc(var(--rc-safe-margin) + 48px + 44px);display:flex;flex-direction:column;gap:20px;color:#fff;text-shadow:0 2px 18px rgba(0,0,0,.35)}
.a-kicker{color:var(--rc-accent-on-dark,#F2B38E);text-transform:uppercase;letter-spacing:.14em;font-weight:600}
.a-sub{opacity:.92}
[data-template="A"] .rc-logo,[data-template="A"] .rc-page{color:#fff}`,
  body: (c) =>
    `${imageSlot(c, "hero", "a-hero")}
<div class="a-shade"></div>
<div class="a-text">
${textSlot(c, "kicker", "a-kicker")}
${textSlot(c, "headline", "a-headline")}
${textSlot(c, "subline", "a-sub")}
</div>`,
};
