import { create, type Font } from "fontkit";
import { familyById, readFontFile } from "./fonts";

// Glyph coverage (plan 08 §8.6, M3-06): every character of every slot must exist in the font the
// slot uses, or the browser would silently fall back to another font (or draw a box). A missing
// glyph blocks the render before Chromium starts (`MISSING_GLYPH`). Emoji are not in the fonts, so
// they are reported too (slide text allows none).

const fonts = new Map<string, Font[]>();

function loadFamily(id: string): Font[] {
  let loaded = fonts.get(id);
  if (!loaded) {
    loaded = familyById(id).files.map((file) => {
      const font = create(readFontFile(file.path));
      // A collection would be an array; ours are single fonts.
      return font as Font;
    });
    fonts.set(id, loaded);
  }
  return loaded;
}

/** Whitespace and line breaks need no glyph of their own. */
const IGNORED = /[\s​-‍⁠﻿]/u;

/** Characters of `text` (each once, in order) that no file of the family covers. */
export function missingGlyphs(text: string, familyId: string): string[] {
  const family = loadFamily(familyId);
  const missing: string[] = [];
  for (const char of new Set(text)) {
    if (IGNORED.test(char)) continue;
    const point = char.codePointAt(0) as number;
    if (!family.some((font) => font.hasGlyphForCodePoint(point))) missing.push(char);
  }
  return missing;
}

export type SlotText = {
  slideId: string;
  slot: string;
  text: string;
  /** The brand font slot the template uses for it (`display` or `body`). */
  font: "display" | "body";
};

export type MissingGlyph = { slideId: string; slot: string; chars: string[] };

/** `QaReport.missingGlyphs`: one entry per slot that has uncovered characters. */
export function findMissingGlyphs(
  slots: readonly SlotText[],
  fontIds: { display: string; body: string },
): MissingGlyph[] {
  const result: MissingGlyph[] = [];
  for (const slot of slots) {
    const chars = missingGlyphs(slot.text, fontIds[slot.font]);
    if (chars.length > 0) result.push({ slideId: slot.slideId, slot: slot.slot, chars });
  }
  return result;
}
