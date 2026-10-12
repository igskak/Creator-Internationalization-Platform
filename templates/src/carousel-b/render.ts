import { cutoutSlot, textSlot } from "../framework/html";
import type { TemplateRenderer } from "../framework/types";

// Template B, large number / fact + explanation (plan 08 §8.2.1). A step number ("02") is drawn in
// ink, any other figure ("1:2", "180 °C") in the accent colour; then label, headline and body in a
// left column. The optional picture is a cut-out bleeding off the right and bottom edges.

const isStepNumber = (text: string | undefined) => /^\d{1,3}$/.test((text ?? "").trim());

export const rendererB: TemplateRenderer = {
  css: `.b-wrap{position:absolute;left:var(--rc-safe-margin);top:112px;bottom:120px;width:760px;display:flex;flex-direction:column;gap:28px}
.b-wrap.has-photo{width:620px}
.b-wrap.has-photo .b-body{width:470px}
.b-number.slot{letter-spacing:-.04em}
.b-number.figure{color:var(--rc-accent)}
.b-photo{transform:translate(280px,240px)}`,
  body: (c) => {
    const photo = cutoutSlot(c, "side", "b-photo");
    const number = isStepNumber(c.slide.slots.number) ? "b-number" : "b-number figure";
    return `${photo}
<div class="b-wrap${photo ? " has-photo" : ""}">
${textSlot(c, "number", number)}
${textSlot(c, "label", "rc-kicker b-label")}
${textSlot(c, "headline", "b-headline")}
${textSlot(c, "body", "b-body")}
</div>`;
  },
};
