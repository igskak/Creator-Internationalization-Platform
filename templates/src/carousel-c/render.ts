import { imageSlot, textSlot } from "../framework/html";
import type { TemplateRenderer } from "../framework/types";

// Template C, before vs after (plan 08 §8.2.1, P1): the caption centred on top, the two labels
// left and right, and the two pictures flanking the slide. Each picture's centre sits on its edge
// of the canvas and fades out towards the middle, so only the outer half of each subject shows.

export const rendererC: TemplateRenderer = {
  css: `.c-caption{position:absolute;left:180px;right:180px;top:112px;text-align:center}
.c-label{position:absolute;top:470px;width:420px;z-index:1}
.c-label.before{left:var(--rc-safe-margin)}
.c-label.after{right:var(--rc-safe-margin);text-align:right}
.c-label.after .slot{color:var(--rc-accent)}
.c-before{transform:translate(-540px,330px);-webkit-mask-image:linear-gradient(90deg,#000 66%,transparent 92%);mask-image:linear-gradient(90deg,#000 66%,transparent 92%)}
.c-after{transform:translate(540px,330px);-webkit-mask-image:linear-gradient(90deg,transparent 8%,#000 34%);mask-image:linear-gradient(90deg,transparent 8%,#000 34%)}`,
  body: (c) =>
    `${imageSlot(c, "before", "cutout c-before")}
${imageSlot(c, "after", "cutout c-after")}
${textSlot(c, "caption", "c-caption")}
<div class="c-label before">${textSlot(c, "beforeLabel")}</div>
<div class="c-label after">${textSlot(c, "afterLabel")}</div>`,
};
