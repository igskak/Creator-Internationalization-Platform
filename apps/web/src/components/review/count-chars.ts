const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Visible characters, counted like the server does (NFC graphemes), without loading the template package. */
export function countChars(text: string): number {
  let count = 0;
  for (const _ of graphemes.segment(text.normalize("NFC"))) count += 1;
  return count;
}
