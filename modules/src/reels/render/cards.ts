import { stripEmphasis } from "@rc/templates";
import { fontFaceCss } from "@rc/templates/render";
import type { Browser } from "playwright-core";
import { CARD, HEIGHT, SAFE_ZONE, WIDTH } from "./constants";

// Text cards as transparent 1080 × 1920 PNGs (reel-style.md "Text cards"): Inter Tight 800, upper
// case, line height 1.0, letter spacing −0.02 em, the ink of the carousel with one accent in its
// red, left aligned at x = 70, top at y = 240, in a 780 px column. Chromium draws them with the
// bundled font; a white halo keeps them readable over a picture that reaches the card.

export type CardMeasure = {
  fontPx: number;
  lines: number;
  box: { x: number; y: number; width: number; height: number };
  /** True when the card needed a font below the normal minimum. */
  belowMinimum: boolean;
  insideSafeZone: boolean;
};

export type RenderedCard = { png: Uint8Array; measure: CardMeasure };

const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** `Hot water on **bulgur?**` → HTML with the accent in a span; an open marker is plain text. */
export function cardInnerHtml(card: string): string {
  const parts = card.split("**");
  if (parts.length % 2 === 0) return escapeHtml(stripEmphasis(card));
  return parts
    .map((part, i) => (i % 2 === 1 ? `<span>${escapeHtml(part)}</span>` : escapeHtml(part)))
    .join("");
}

export function cardPageHtml(card: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaceCss("inter-tight")}
html,body{margin:0;background:transparent}
.w{width:${WIDTH}px;height:${HEIGHT}px;position:relative;font-family:"Inter Tight",sans-serif}
.t{position:absolute;left:${CARD.left}px;top:${CARD.top}px;width:${CARD.width}px;font-weight:800;line-height:1;
letter-spacing:-.02em;text-transform:uppercase;color:${CARD.ink};text-wrap:balance;overflow-wrap:normal;
paint-order:stroke fill;-webkit-text-stroke:14px rgba(255,255,255,.92)}
.t span{color:${CARD.accent}}
</style></head><body><div class="w"><div class="t" data-card>${cardInnerHtml(card)}</div></div></body></html>`;
}

/**
 * Runs in the page: the largest font size from the maximum down to the minimum (then the floor) at
 * which the card has at most three lines and no word is wider than the column. Source text,
 * because the Node build has no DOM types.
 */
const FIT_SOURCE = `(cfg) => {
  const el = document.querySelector("[data-card]");
  const sizes = [];
  for (let px = cfg.maxFontPx; px >= cfg.floorFontPx; px -= cfg.stepPx) sizes.push(px);
  let chosen = sizes[sizes.length - 1];
  for (const px of sizes) {
    el.style.fontSize = px + "px";
    const lines = Math.round(el.getBoundingClientRect().height / px);
    if (lines <= cfg.maxLines && el.scrollWidth <= cfg.width + 1) { chosen = px; break; }
  }
  el.style.fontSize = chosen + "px";
  const r = el.getBoundingClientRect();
  return { fontPx: chosen, lines: Math.round(r.height / chosen), box: { x: r.x, y: r.y, width: r.width, height: r.height } };
}`;

export async function renderCard(browser: Browser, card: string): Promise<RenderedCard> {
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });
  try {
    await page.setContent(cardPageHtml(card), { waitUntil: "load" });
    await page.evaluate("document.fonts.ready");
    const fit = (await page.evaluate(`(${FIT_SOURCE})(${JSON.stringify(CARD)})`)) as Omit<
      CardMeasure,
      "belowMinimum" | "insideSafeZone"
    >;
    const bottom = fit.box.y + fit.box.height;
    const png = await page.screenshot({ type: "png", omitBackground: true });
    return {
      png: new Uint8Array(png),
      measure: {
        ...fit,
        belowMinimum: fit.fontPx < CARD.minFontPx,
        insideSafeZone:
          fit.box.y >= SAFE_ZONE.top - 1 &&
          bottom <= SAFE_ZONE.bottom + 1 &&
          fit.box.x + fit.box.width <= SAFE_ZONE.right + 1,
      },
    };
  } finally {
    await page.close();
  }
}
