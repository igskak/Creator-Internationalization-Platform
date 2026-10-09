import { imageSlot, textSlot } from "../framework/html";
import type { TemplateRenderer } from "../framework/types";

// Template E, mistake vs correct technique (plan 08 §8.2.1): two panels, the mistake with a
// negative accent bar and the correct way with a positive one, and an optional square picture on
// top. No icon glyphs: the fonts have none, so the bars carry the meaning.

export const rendererE: TemplateRenderer = {
  css: `.e-wrap{position:absolute;left:var(--rc-safe-margin);right:var(--rc-safe-margin);top:calc(var(--rc-safe-margin) + 24px);bottom:calc(var(--rc-safe-margin) + 48px + 40px);display:flex;flex-direction:column;gap:32px;justify-content:center}
.e-image{width:260px;height:260px;border-radius:28px;align-self:center}
.e-panel{background:var(--rc-surface);border-radius:28px;padding:40px 44px;display:flex;flex-direction:column;gap:16px;border-left:14px solid var(--rc-negative)}
.e-panel.correct{border-left-color:var(--rc-positive)}
.e-mistake-title{color:var(--rc-negative)}
.e-correct-title{color:var(--rc-positive)}`,
  body: (c) =>
    `<div class="e-wrap">
${c.assets.images.image ? imageSlot(c, "image", "e-image") : ""}
<div class="e-panel mistake">
${textSlot(c, "mistakeTitle", "e-mistake-title")}
${textSlot(c, "mistakeText", "e-mistake-text")}
</div>
<div class="e-panel correct">
${textSlot(c, "correctTitle", "e-correct-title")}
${textSlot(c, "correctText", "e-correct-text")}
</div>
</div>`,
};
