import { readFile } from "node:fs/promises";
import iconv from "iconv-lite";
import type { ExtractedPage } from "./pdf";
import { type Block, headingTrail, paginate, SECTION_SEPARATOR } from "./pseudo-pages";
import { detectTextEncoding, type TextEncoding } from "./sniff";

/** Decodes a text file (BOM removed, `\n` line ends). Throws SourceRejectedError if not text. */
export function decodeText(bytes: Uint8Array, encoding?: TextEncoding): string {
  const detected = encoding ?? detectTextEncoding(bytes);
  const text =
    detected === "windows-1251"
      ? iconv.decode(Buffer.from(bytes), "win1251")
      : new TextDecoder("utf-8").decode(bytes);
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

const MD_HEADING = /^(#{1,6})[ \t]+(.+?)[ \t#]*$/;

/** Blocks of a plain or Markdown text: paragraphs split at blank lines; `#` lines are headings. */
export function textBlocks(text: string, markdown: boolean): Block[] {
  const blocks: Block[] = [];
  let trail: string[] = [];
  let paragraph: string[] = [];
  let inFence = false;
  const path = () => (trail.length ? trail.join(SECTION_SEPARATOR) : null);
  const endParagraph = () => {
    if (paragraph.length) blocks.push({ sectionPath: path(), text: paragraph.join("\n") });
    paragraph = [];
  };

  for (const line of text.split("\n")) {
    if (markdown && /^(```|~~~)/.test(line.trim())) inFence = !inFence;
    const heading = markdown && !inFence ? MD_HEADING.exec(line) : null;
    if (heading?.[1] && heading[2]) {
      endParagraph();
      trail = headingTrail(trail, heading[1].length, heading[2].trim());
      blocks.push({ sectionPath: path(), text: heading[2].trim() });
    } else if (line.trim() === "") {
      endParagraph();
    } else {
      paragraph.push(line);
    }
  }
  endParagraph();
  return blocks;
}

/** TXT / MD file → pseudo-pages; Markdown headings become `section_path`. */
export async function parseTextFile(
  path: string,
  options: { markdown: boolean; encoding?: TextEncoding },
): Promise<ExtractedPage[]> {
  const text = decodeText(new Uint8Array(await readFile(path)), options.encoding);
  return paginate(textBlocks(text, options.markdown));
}
