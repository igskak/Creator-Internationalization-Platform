import { cutoutSlot, isRightHand, placementOf, textSlot } from "../framework/html";
import type { TemplateRenderer } from "../framework/types";

// Template D, diagram / mechanism (plan 08 §8.2.1, P1): a title and three to five points in order,
// drawn as a tree: one thin vertical rule with a tick per point. The optional picture is a cut-out
// in the lower-right corner.

export const rendererD: TemplateRenderer = {
  css: `.d-wrap{position:absolute;left:var(--rc-safe-margin);top:112px;bottom:120px;width:760px;display:flex;flex-direction:column;gap:44px}
.d-steps{width:560px;border-left:2px solid var(--rc-text);display:flex;flex-direction:column}
.d-step{position:relative;padding:14px 0 14px 44px}
.d-step::before{content:"";position:absolute;left:0;top:36px;width:30px;height:2px;background:var(--rc-text)}
.d-photo{transform:translate(200px,280px)}
.d-wrap.narrow{width:520px}
.d-wrap.narrow .d-steps{width:500px}`,
  body: (c) => {
    const steps: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const text = textSlot(c, `step${i}`, "d-text");
      if (text) steps.push(`<div class="d-step" data-step="${i}">${text}</div>`);
    }
    const photo = cutoutSlot(c, "image", "d-photo");
    const narrow = photo && isRightHand(placementOf(c, "image")) ? " narrow" : "";
    return `${photo}
<div class="d-wrap${narrow}">
${textSlot(c, "title", "d-title")}
<div class="d-steps">
${steps.join("\n")}
</div>
</div>`;
  },
};
