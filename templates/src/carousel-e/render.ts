import { cutoutSlot, textSlot } from "../framework/html";
import type { TemplateRenderer } from "../framework/types";

// Template E, mistake vs correct technique (plan 08 §8.2.1): the mistake in muted type, struck out
// in the negative colour, then the correct way large and in ink, its ladder text and an optional
// bold closing line, in a left column (468 px for the texts, carousel v3). The optional picture is
// a cut-out placed by its measured subject (place-photo.ts).

export const rendererE: TemplateRenderer = {
  css: `.e-wrap{position:absolute;left:var(--rc-safe-margin);top:100px;bottom:112px;width:600px;display:flex;flex-direction:column}
.e-mistake-title{color:var(--rc-muted);text-decoration:line-through;text-decoration-color:var(--rc-negative);text-decoration-thickness:.11em}
.e-mistake-text{color:var(--rc-muted);width:468px;margin-top:14px}
.e-correct-title{color:var(--rc-positive);margin-top:44px}
.e-correct-text{width:468px;margin-top:24px}
.e-closer{margin-top:24px}
.e-photo{transform:translate(330px,400px)}`,
  body: (c) => {
    const photo = cutoutSlot(c, "image", "e-photo");
    return `${photo}
<div class="e-wrap">
${textSlot(c, "mistakeTitle", "e-mistake-title")}
${textSlot(c, "mistakeText", "e-mistake-text")}
${textSlot(c, "correctTitle", "e-correct-title")}
${textSlot(c, "correctText", "e-correct-text")}
${textSlot(c, "closer", "closer e-closer")}
</div>`;
  },
};
