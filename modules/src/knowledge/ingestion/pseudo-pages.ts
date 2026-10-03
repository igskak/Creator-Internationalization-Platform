import type { PageLocator } from "@rc/db/json";
import type { ExtractedPage } from "./pdf";

// Pseudo-pages for sources without pages (plan 07 §7.2.2): about 3,000 characters, never across a
// heading, so a page belongs to exactly one section and quotes can cite page + section.

export const PSEUDO_PAGE_CHARS = 3000;

/** One paragraph, heading line or subtitle cue, in reading order. */
export type Block = {
  /** Heading trail of the section the block belongs to; null before the first heading. */
  sectionPath: string | null;
  text: string;
  locator?: PageLocator;
};

/** Longest piece of `text` up to `max` characters, cut at whitespace when possible. */
function splitLong(text: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const cut = rest.lastIndexOf(" ", max);
    const at = cut > max / 2 ? cut : max;
    pieces.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/**
 * Packs blocks into pages of at most `max` characters. A page break is forced when the section
 * changes. A block longer than `max` is split at whitespace. Pages are numbered from 1.
 */
export function paginate(
  blocks: readonly Block[],
  options: { separator?: string; max?: number } = {},
): ExtractedPage[] {
  const separator = options.separator ?? "\n\n";
  const max = options.max ?? PSEUDO_PAGE_CHARS;
  const pages: ExtractedPage[] = [];
  let section: string | null = null;
  let texts: string[] = [];
  let length = 0;
  let locator: PageLocator | undefined;

  const flush = () => {
    if (texts.length === 0) return;
    const text = texts.join(separator);
    pages.push({
      pageNumber: pages.length + 1,
      text,
      charCount: text.length,
      hasTextLayer: true,
      sectionPath: section,
      ...(locator ? { locator } : {}),
    });
    texts = [];
    length = 0;
    locator = undefined;
  };

  for (const block of blocks) {
    const text = block.text.trim();
    if (!text) continue;
    if (texts.length > 0 && block.sectionPath !== section) flush();
    section = block.sectionPath;
    for (const piece of splitLong(text, max)) {
      const added = texts.length === 0 ? piece.length : separator.length + piece.length;
      if (texts.length > 0 && length + added > max) flush();
      length += texts.length === 0 ? piece.length : separator.length + piece.length;
      texts.push(piece);
      if (block.locator) {
        locator = {
          ...(locator ?? block.locator),
          ...(block.locator.endMs === undefined ? {} : { endMs: block.locator.endMs }),
        };
      }
    }
  }
  flush();
  return pages;
}

/** Heading trail: level n replaces everything at depth ≥ n. */
export function headingTrail(trail: string[], level: number, title: string): string[] {
  return [...trail.slice(0, level - 1), title];
}

export const SECTION_SEPARATOR = " › ";
