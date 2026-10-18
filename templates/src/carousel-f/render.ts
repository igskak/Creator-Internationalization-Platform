import { cutoutSlot, textSlot } from "../framework/html";
import type { TemplateRenderer } from "../framework/types";

// Template F, CTA / lead magnet / offer (plan 08 §8.2.1): offer name, a large headline, a ladder
// body and the keyword as large accent text (no filled block) in a left column (468 px for the
// body, carousel v3). The optional product picture is a cut-out placed by its measured subject.

export const rendererF: TemplateRenderer = {
  css: `.f-wrap{position:absolute;left:var(--rc-safe-margin);top:100px;bottom:112px;width:600px;display:flex;flex-direction:column;gap:26px}
.f-offer{color:var(--rc-accent)}
.f-body{width:468px}
.f-keyword{color:var(--rc-accent);letter-spacing:.02em;width:468px}
.f-photo{transform:translate(180px,320px)}`,
  body: (c) => {
    const photo = cutoutSlot(c, "product", "f-photo");
    return `${photo}
<div class="f-wrap">
${textSlot(c, "offerName", "rc-kicker f-offer")}
${textSlot(c, "headline", "f-headline")}
${textSlot(c, "body", "f-body")}
${textSlot(c, "keyword", "f-keyword")}
</div>`;
  },
};
