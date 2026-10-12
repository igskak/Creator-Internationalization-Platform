import { cutoutSlot, textSlot } from "../framework/html";
import type { TemplateRenderer } from "../framework/types";

// Template E, mistake vs correct technique (plan 08 §8.2.1): the mistake in muted type, struck out
// in the negative colour, then the correct way large and in ink, in a left column. The optional
// picture is a cut-out bleeding off the right and bottom edges.

export const rendererE: TemplateRenderer = {
  css: `.e-wrap{position:absolute;left:var(--rc-safe-margin);top:112px;bottom:120px;width:560px;display:flex;flex-direction:column}
.e-mistake-title{color:var(--rc-muted);text-decoration:line-through;text-decoration-color:var(--rc-negative);text-decoration-thickness:.11em}
.e-mistake-text{color:var(--rc-muted);width:470px;margin-top:16px}
.e-correct-title{color:var(--rc-positive);margin-top:56px}
.e-correct-text{width:470px;margin-top:32px}
.e-photo{transform:translate(330px,400px)}`,
  body: (c) =>
    `${cutoutSlot(c, "image", "e-photo")}
<div class="e-wrap">
${textSlot(c, "mistakeTitle", "e-mistake-title")}
${textSlot(c, "mistakeText", "e-mistake-text")}
${textSlot(c, "correctTitle", "e-correct-title")}
${textSlot(c, "correctText", "e-correct-text")}
</div>`,
};
