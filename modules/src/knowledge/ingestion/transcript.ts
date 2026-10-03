import { readFile } from "node:fs/promises";
import type { ExtractedPage } from "./pdf";
import type { Block } from "./pseudo-pages";
import { paginate } from "./pseudo-pages";
import { SourceRejectedError, type TextEncoding } from "./sniff";
import { decodeText } from "./text";

// SRT / VTT → cues → segments of about 3,000 characters with a `{startMs, endMs}` locator.

const TIME = /(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})/;
const CUE_LINE = new RegExp(`^\\s*(${TIME.source})\\s*-->\\s*(${TIME.source})`);

const toMs = (h: string | undefined, m: string, s: string, ms: string) =>
  ((Number(h ?? 0) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(ms);

export type Cue = { startMs: number; endMs: number; text: string };

/** Cues of an SRT or WebVTT text. Header, NOTE/STYLE blocks, cue ids and markup are dropped. */
export function parseCues(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((line) => CUE_LINE.test(line));
    if (at < 0) continue;
    const m = CUE_LINE.exec(lines[at] ?? "");
    if (!m) continue;
    const cue = lines
      .slice(at + 1)
      .join("\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\{\\[^}]*\}/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ");
    if (!cue) continue;
    cues.push({
      startMs: toMs(m[2], m[3] ?? "0", m[4] ?? "0", m[5] ?? "0"),
      endMs: toMs(m[7], m[8] ?? "0", m[9] ?? "0", m[10] ?? "0"),
      text: cue,
    });
  }
  return cues;
}

export function cueBlocks(cues: readonly Cue[]): Block[] {
  return cues.map((cue) => ({
    sectionPath: null,
    text: cue.text,
    locator: { startMs: cue.startMs, endMs: cue.endMs },
  }));
}

/** SRT / VTT file → segments; a page's locator spans from its first cue start to its last cue end. */
export async function parseTranscriptFile(
  path: string,
  options: { encoding?: TextEncoding } = {},
): Promise<ExtractedPage[]> {
  const text = decodeText(new Uint8Array(await readFile(path)), options.encoding);
  const cues = parseCues(text);
  if (cues.length === 0) {
    throw new SourceRejectedError("EMPTY_FILE", "No subtitle cues were found in the file.");
  }
  return paginate(cueBlocks(cues), { separator: "\n" });
}
