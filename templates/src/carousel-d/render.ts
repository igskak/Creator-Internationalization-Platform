import { imageSlot, textSlot } from "../framework/html";
import type { TemplateRenderer } from "../framework/types";
import { readIcon, STEP_ICONS } from "../icons";

// Template D, diagram / mechanism (plan 08 §8.2.1, P1): a title and three to five numbered steps,
// each with an icon of the template's own set, in order. An optional small picture sits right-aligned under the title.

export const rendererD: TemplateRenderer = {
  css: `.d-wrap{position:absolute;left:var(--rc-safe-margin);right:var(--rc-safe-margin);top:calc(var(--rc-safe-margin) + 24px);bottom:calc(var(--rc-safe-margin) + 48px + 40px);display:flex;flex-direction:column;gap:36px}
.d-image{width:160px;height:160px;border-radius:24px;flex:none;align-self:flex-end}
.d-steps{display:flex;flex-direction:column;gap:28px;margin-top:auto}
.d-step{display:flex;align-items:center;gap:28px}
.d-icon{flex:none;width:88px;height:88px;border-radius:50%;background:var(--rc-accent);color:#fff;display:flex;align-items:center;justify-content:center;position:relative}
.d-icon svg{width:46px;height:46px}
.d-num{position:absolute;top:-8px;left:-8px;width:36px;height:36px;border-radius:50%;background:var(--rc-text);color:var(--rc-bg);font:600 22px/36px var(--rc-font-body);text-align:center}
.d-step .slot{flex:1}`,
  body: (c) => {
    const steps: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const text = textSlot(c, `step${i}`, "d-text");
      if (!text) continue;
      const icon = readIcon(STEP_ICONS[i - 1] as (typeof STEP_ICONS)[number]);
      steps.push(
        `<div class="d-step" data-step="${i}"><div class="d-icon" data-icon="${STEP_ICONS[i - 1]}">${icon}<span class="d-num">${i}</span></div>${text}</div>`,
      );
    }
    return `<div class="d-wrap">
${textSlot(c, "title", "d-title")}
${c.assets.images.image ? imageSlot(c, "image", "d-image") : ""}
<div class="d-steps">
${steps.join("\n")}
</div>
</div>`;
  },
};
