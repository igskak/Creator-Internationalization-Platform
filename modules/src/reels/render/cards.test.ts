import { REEL_POSTS, REEL_POSTS_V4 } from "@rc/prompts/fixtures/reel-director";
import type { Browser } from "playwright-core";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { launchBrowser } from "../../visuals/render";
import { cardInnerHtml, cardPageHtml, renderCard } from "./cards";
import { CARD, LINE } from "./constants";

// Cards need a Chromium (the one CI installs, a local Chrome on a Mac); without a browser the
// browser tests are skipped.

const browser: Browser | undefined = await launchBrowser().catch(() => undefined);
afterAll(async () => {
  await browser?.close();
});

describe("card HTML", () => {
  it("adds the line of use as its own escaped element, and nothing without one", () => {
    const html = cardPageHtml("Hot water on **bulgur?**", "Fine <b>bulgur</b> soaks.");
    expect(html).toContain('<div class="l" data-line>Fine &lt;b&gt;bulgur&lt;/b&gt; soaks.</div>');
    expect(cardPageHtml("Hot water on **bulgur?**")).not.toContain("data-line>");
  });

  it("turns **accent** into a span and escapes the rest", () => {
    expect(cardInnerHtml("Hot water on **bulgur?**")).toBe("Hot water on <span>bulgur?</span>");
    expect(cardInnerHtml("Fish & <chips> **now**")).toBe(
      "Fish &amp; &lt;chips&gt; <span>now</span>",
    );
  });

  it("shows an open marker as plain text without the asterisks", () => {
    expect(cardInnerHtml("Uno **dos")).toBe("Uno dos");
  });

  it("uses the carousel's ink and red, Inter Tight 800 and the card position", () => {
    const html = cardPageHtml("A **b**");
    expect(html).toContain('font-family:"Inter Tight"');
    expect(html).toContain("font-weight:800");
    expect(html).toContain(CARD.ink);
    expect(html).toContain(CARD.accent);
    expect(html).toContain(`left:${CARD.left}px;top:${CARD.top}px;width:${CARD.width}px`);
  });
});

describe.skipIf(!browser)("renderCard", () => {
  const draw = (card: string) => renderCard(browser as Browser, card);

  it("draws a transparent 1080 × 1920 PNG with the text in ink and the accent in red", async () => {
    const { png } = await draw("Hot water on **bulgur?**");
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height, info.channels]).toEqual([1080, 1920, 4]);
    // The corner is see-through.
    expect(data[3]).toBe(0);
    let red = 0;
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i + 3] ?? 0) < 250) continue;
      const [r, g, b] = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
      if (r > 200 && g < 60 && b < 60) red++;
      if (r < 40 && g < 40 && b < 40) ink++;
    }
    expect(red).toBeGreaterThan(1000);
    expect(ink).toBeGreaterThan(1000);
  });

  it("uses the largest font for a short card and keeps it in the column and the safe zone", async () => {
    const { measure } = await draw("Save it");
    expect(measure.fontPx).toBe(CARD.maxFontPx);
    expect(measure.lines).toBe(1);
    expect(measure.insideSafeZone).toBe(true);
    expect(measure.box.x).toBe(CARD.left);
    expect(measure.box.y).toBe(CARD.top);
    expect(measure.box.width).toBe(CARD.width);
  });

  it("shrinks a long card to at most three lines inside the safe zone", async () => {
    const { measure } = await draw("Caldo caliente, **cucharón a cucharón.**");
    expect(measure.lines).toBeLessThanOrEqual(CARD.maxLines);
    expect(measure.fontPx).toBeLessThan(CARD.maxFontPx);
    expect(measure.insideSafeZone).toBe(true);
  });

  it("fits every card of the synthetic posts at the normal minimum or above", async () => {
    const cards = REEL_POSTS.flatMap((p) => p.output.scenes.map((s) => s.card));
    expect(cards.length).toBeGreaterThanOrEqual(20);
    for (const card of cards) {
      const { measure } = await draw(card);
      expect(measure.lines, card).toBeLessThanOrEqual(CARD.maxLines);
      expect(measure.belowMinimum, `${card} at ${measure.fontPx}px`).toBe(false);
      expect(measure.insideSafeZone, card).toBe(true);
    }
  }, 120_000);

  it("puts the line of use under the card, smaller, in the column and the safe zone", async () => {
    if (!browser) return;
    const plain = await renderCard(browser, "Ahí se va lo **meloso.**");
    const withLine = await renderCard(
      browser,
      "Ahí se va lo **meloso.**",
      "El almidón de la superficie es lo que hace el risotto meloso.",
    );
    expect(withLine.measure.fontPx).toBe(plain.measure.fontPx);
    expect(withLine.measure.box.height).toBeGreaterThan(
      plain.measure.box.height + LINE.gapPx + LINE.minFontPx,
    );
    expect(withLine.measure.insideSafeZone).toBe(true);
  });

  it("fits every card and line of the v4 posts inside the safe zone", async () => {
    if (!browser) return;
    for (const post of REEL_POSTS_V4) {
      for (const scene of post.output.scenes) {
        const { measure } = await renderCard(browser, scene.card, scene.line);
        expect(measure.insideSafeZone, `${scene.card} / ${scene.line}`).toBe(true);
        expect(measure.belowMinimum, scene.card).toBe(false);
      }
    }
  }, 120_000);

  it("draws a Spanish card with its accents and inverted marks", async () => {
    const { measure } = await draw("¿Aún lavas el arroz **del risotto?**");
    expect(measure.insideSafeZone).toBe(true);
    expect(measure.lines).toBeLessThanOrEqual(CARD.maxLines);
  });
});
