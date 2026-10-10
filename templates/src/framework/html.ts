import type { ImageSlotSpec, TextSlotSpec } from "../define-template";
import type { RenderContext } from "./types";

// Helpers the template renderers build their markup from (08 §8.2, §8.6).

export const CANVAS = { width: 1080, height: 1350 } as const;

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

/** Text with its line breaks kept, escaped. */
export const textHtml = (text: string): string => escapeHtml(text).replace(/\r?\n/g, "<br>");

/** Line height of the two font roles (08 §8.3). */
export const LINE_HEIGHT = { display: 1.12, body: 1.3 } as const;

/**
 * Vertical padding of a slot in em. A font's glyph box is taller than a tight line height (Fraunces
 * at 1.12), and the browser counts that extra as scrollable overflow; the padding gives it room, so
 * only text that really needs another line is reported as overflow.
 */
export const SLOT_PAD_EM = { display: 0.1, body: 0.06 } as const;

/**
 * The most a text slot may grow: `maxLines` lines at the largest size. The slot is as tall as its
 * text up to this limit (`max-height`, `overflow:hidden`); the fit-text script shrinks the font
 * until the text fits it, and text that still overflows at the smallest size is marked
 * `data-overflow` (a QA blocker).
 */
export const slotBoxHeightPx = (spec: TextSlotSpec): number =>
  Math.round(
    spec.maxLines * spec.maxPx * LINE_HEIGHT[spec.font] + 2 * spec.maxPx * SLOT_PAD_EM[spec.font],
  );

/**
 * A text slot element, or nothing for an optional slot without text. `className` positions it
 * in the template; sizes come from the template's metadata, so the writer's limits, the validators
 * and the render agree.
 */
export function textSlot(context: RenderContext, name: string, className = ""): string {
  const spec = context.template.textSlots[name];
  if (!spec) throw new Error(`Template ${context.template.id} has no text slot "${name}".`);
  const text = context.slide.slots[name];
  if (!text?.trim()) return "";
  const family = spec.font === "display" ? "display" : "body";
  return `<div class="slot ${family} ${escapeHtml(className)}" data-slot="${escapeHtml(name)}" data-fit data-fit-min="${spec.minPx}" data-fit-max="${spec.maxPx}" style="font-size:${spec.maxPx}px;max-height:${slotBoxHeightPx(spec)}px">${textHtml(text)}</div>`;
}

/**
 * An image slot: the picture, or a marked empty box when there is none (an optional slot is then
 * simply left out by the renderer; a required one is caught by the QA as `data-image-missing`).
 */
export function imageSlot(context: RenderContext, name: string, className = ""): string {
  const spec: ImageSlotSpec | undefined = context.template.imageSlots[name];
  if (!spec) throw new Error(`Template ${context.template.id} has no image slot "${name}".`);
  const src = context.assets.images[name];
  const cls = `img ${escapeHtml(className)}`.trim();
  if (!src) {
    return `<div class="${cls} img-missing" data-image="${escapeHtml(name)}" data-image-missing data-required="${spec.required}"></div>`;
  }
  return `<img class="${cls}" data-image="${escapeHtml(name)}" alt="" src="${src}">`;
}
