import { imageSlot, textSlot } from "../framework/html";
import type { TemplateRenderer } from "../framework/types";

// Template B, large number / fact + explanation (plan 08 §8.2.1). With a `number` it opens with a
// big accent figure and its label; without one it is a headline + body slide. An optional square
// picture sits at the bottom right.

export const rendererB: TemplateRenderer = {
  css: `.b-wrap{position:absolute;left:var(--rc-safe-margin);right:var(--rc-safe-margin);top:calc(var(--rc-safe-margin) + 24px);bottom:calc(var(--rc-safe-margin) + 48px + 40px);display:flex;flex-direction:column;gap:28px}
.b-number{color:var(--rc-accent);line-height:1}
.b-label{text-transform:uppercase;letter-spacing:.12em;font-weight:600;opacity:.75}
.b-side{width:340px;height:340px;border-radius:28px;margin-top:auto;align-self:flex-end}`,
  body: (c) =>
    `<div class="b-wrap">
${textSlot(c, "number", "b-number")}
${textSlot(c, "label", "b-label")}
${textSlot(c, "headline", "b-headline")}
${textSlot(c, "body", "b-body")}
${c.assets.images.side ? imageSlot(c, "side", "b-side") : ""}
</div>`,
};
