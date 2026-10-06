import { embeddingHash } from "@rc/lib/providers/embeddings";
import { charsPerToken } from "../extraction/plan";

// Source chunks for semantic search over the raw text (plan 06 §6.3 step 6, M1-21): pages are cut
// into pieces of about 800 tokens that overlap by about 100. They are built from whole sentences
// (a sentence longer than a chunk is cut by words), and each piece remembers the pages and section
// it came from. Pure and deterministic.

export const CHUNK_TOKENS = 800;
export const CHUNK_OVERLAP_TOKENS = 100;

export type ChunkPage = { pageNumber: number; text: string; sectionPath?: string | null };

export type SourceChunk = {
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  sectionPath: string | null;
  text: string;
  tokenEstimate: number;
  /** SHA-256 of `text`: a chunk whose text did not change keeps its vector. */
  contentHash: string;
};

/** A sentence (or a piece of one); `sep` is what precedes it: a line break opens a paragraph. */
type Unit = {
  text: string;
  sep: "\n" | " ";
  page: number;
  section: string | null;
  tokens: number;
};

/** Sentences, then words, so that no unit is longer than `maxChars`. */
function splitLong(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const out: string[] = [];
  let current = "";
  const push = (piece: string) => {
    if (current && current.length + piece.length + 1 > maxChars) {
      out.push(current);
      current = "";
    }
    current = current ? `${current} ${piece}` : piece;
  };
  for (const sentence of text.split(/(?<=[.!?…])\s+/u)) {
    if (sentence.length <= maxChars) {
      push(sentence);
      continue;
    }
    for (const word of sentence.split(/\s+/u)) {
      // A "word" longer than a whole chunk (a URL, a table row) is cut where it stands.
      for (let i = 0; i < word.length; i += maxChars) push(word.slice(i, i + maxChars));
    }
  }
  if (current) out.push(current);
  return out;
}

export function chunkPages(
  pages: readonly ChunkPage[],
  language: string,
  options: { targetTokens?: number; overlapTokens?: number } = {},
): SourceChunk[] {
  const target = options.targetTokens ?? CHUNK_TOKENS;
  const overlap = options.overlapTokens ?? CHUNK_OVERLAP_TOKENS;
  const perToken = charsPerToken(language);
  const tokensOf = (text: string) => Math.ceil(text.length / perToken);

  const units: Unit[] = [];
  for (const page of [...pages].sort((a, b) => a.pageNumber - b.pageNumber)) {
    for (const paragraph of page.text.split(/\n+/u)) {
      const clean = paragraph.replace(/[ \t]+/gu, " ").trim();
      if (!clean) continue;
      let opens = true;
      for (const sentence of clean.split(/(?<=[.!?…])\s+/u)) {
        for (const piece of splitLong(sentence, target * perToken)) {
          units.push({
            text: piece,
            sep: opens ? "\n" : " ",
            page: page.pageNumber,
            section: page.sectionPath ?? null,
            tokens: tokensOf(piece),
          });
          opens = false;
        }
      }
    }
  }

  const chunks: SourceChunk[] = [];
  let current: Unit[] = [];
  /** How many of the leading units of `current` are the overlap carried over from the last chunk. */
  let carried = 0;
  const flush = () => {
    const text = current.map((u, i) => (i === 0 ? u.text : `${u.sep}${u.text}`)).join("");
    const first = current[0];
    if (!first) return;
    chunks.push({
      chunkIndex: chunks.length,
      pageStart: Math.min(...current.map((u) => u.page)),
      pageEnd: Math.max(...current.map((u) => u.page)),
      sectionPath: first.section,
      text,
      tokenEstimate: tokensOf(text),
      contentHash: embeddingHash(text),
    });
    // The tail of this chunk opens the next one, as long as it leaves room for something new.
    const tail: Unit[] = [];
    let tokens = 0;
    for (let i = current.length - 1; i > 0; i--) {
      const unit = current[i];
      if (!unit || tokens + unit.tokens > overlap) break;
      tail.unshift(unit);
      tokens += unit.tokens;
    }
    current = tail;
    carried = tail.length;
  };

  for (const unit of units) {
    const size = current.reduce((sum, u) => sum + u.tokens, 0);
    if (current.length > carried && size + unit.tokens > target) flush();
    current.push(unit);
  }
  if (current.length > carried) flush();
  return chunks;
}
