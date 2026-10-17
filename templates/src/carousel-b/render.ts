import { cutoutSlot, textSlot } from "../framework/html";
import type { TemplateRenderer } from "../framework/types";

// Template B, large number / fact + explanation (plan 08 §8.2.1). A step number ("02") is drawn in
// ink, any other figure ("1:2", "180 °C") in the accent colour; then label, lead, headline, a
// ladder body and a bold closing line in a left column (carousel v3: the headline may run wider
// than the 468 px body column, the picture is fitted around both). The optional picture is a
// cut-out placed by its measured subject (place-photo.ts).

/** "02", or a word for "step" with its digits ("Step 1", "Paso 2"): drawn in ink, not as a figure. */
const isStepNumber = (text: string | undefined) =>
  /^(?:\p{L}+\s+)?\d{1,3}$/u.test((text ?? "").trim());

export const rendererB: TemplateRenderer = {
  css: `.b-wrap{position:absolute;left:var(--rc-safe-margin);top:100px;bottom:112px;width:820px;display:flex;flex-direction:column;gap:22px}
.b-wrap.has-photo{width:600px}
.b-wrap.has-photo .b-body{width:468px}
.b-number.slot{letter-spacing:-.04em}
.b-number.figure{color:var(--rc-accent)}
.b-lead + .b-headline{margin-top:-14px}
.b-photo{transform:translate(280px,240px)}`,
  body: (c) => {
    const photo = cutoutSlot(c, "side", "b-photo");
    const number = isStepNumber(c.slide.slots.number) ? "b-number" : "b-number figure";
    return `${photo}
<div class="b-wrap${photo ? " has-photo" : ""}">
${textSlot(c, "number", number)}
${textSlot(c, "label", "rc-kicker b-label")}
${textSlot(c, "lead", "lead b-lead")}
${textSlot(c, "headline", "b-headline")}
${textSlot(c, "body", "b-body")}
${textSlot(c, "closer", "closer b-closer")}
</div>`;
  },
};
