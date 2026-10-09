import { imageSlot, textSlot } from "../framework/html";
import type { TemplateRenderer } from "../framework/types";

// Template F, CTA / lead magnet / offer (plan 08 §8.2.1): a calm light slide with the call to
// action. An optional product picture on top, then headline and body, the offer name and the
// keyword in an accent block.

export const rendererF: TemplateRenderer = {
  css: `.f-wrap{position:absolute;left:var(--rc-safe-margin);right:var(--rc-safe-margin);top:var(--rc-safe-margin);bottom:calc(var(--rc-safe-margin) + 48px + 40px);display:flex;flex-direction:column;justify-content:center;gap:32px}
.f-product{width:360px;height:360px;border-radius:28px;align-self:flex-start}
.f-offer{color:var(--rc-accent);text-transform:uppercase;letter-spacing:.12em;font-weight:600}
.f-keyword-box{align-self:flex-start;background:var(--rc-accent);color:#fff;border-radius:24px;padding:20px 44px}
.f-keyword-box .slot{color:#fff;letter-spacing:.06em}`,
  body: (c) => {
    const keyword = textSlot(c, "keyword", "f-keyword");
    return `<div class="f-wrap">
${c.assets.images.product ? imageSlot(c, "product", "f-product") : ""}
${textSlot(c, "offerName", "f-offer")}
${textSlot(c, "headline", "f-headline")}
${textSlot(c, "body", "f-body")}
${keyword ? `<div class="f-keyword-box">${keyword}</div>` : ""}
</div>`;
  },
};
