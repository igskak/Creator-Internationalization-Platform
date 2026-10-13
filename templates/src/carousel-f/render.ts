import { cutoutSlot, isRightHand, placementOf, textSlot } from "../framework/html";
import type { TemplateRenderer } from "../framework/types";

// Template F, CTA / lead magnet / offer (plan 08 §8.2.1): offer name, a large headline, body and
// the keyword as accent text (no filled block) in a left column. The optional product picture is
// a cut-out bleeding off the right and bottom edges.

export const rendererF: TemplateRenderer = {
  css: `.f-wrap{position:absolute;left:var(--rc-safe-margin);top:112px;bottom:120px;width:620px;display:flex;flex-direction:column;gap:32px}
.f-offer{color:var(--rc-accent)}
.f-body{width:470px}
.f-keyword{color:var(--rc-accent);letter-spacing:.02em}
.f-photo{transform:translate(180px,320px)}
.f-wrap.narrow{width:520px}`,
  body: (c) => {
    const photo = cutoutSlot(c, "product", "f-photo");
    const narrow = photo && isRightHand(placementOf(c, "product")) ? " narrow" : "";
    return `${photo}
<div class="f-wrap${narrow}">
${textSlot(c, "offerName", "rc-kicker f-offer")}
${textSlot(c, "headline", "f-headline")}
${textSlot(c, "body", "f-body")}
${textSlot(c, "keyword", "f-keyword")}
</div>`;
  },
};
