import mammoth from "mammoth";
import type { ExtractedPage } from "./pdf";
import { type Block, headingTrail, paginate, SECTION_SEPARATOR } from "./pseudo-pages";
import { SourceRejectedError } from "./sniff";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

const inlineText = (html: string) =>
  decodeEntities(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+/g, " ")
    .trim();

/**
 * Blocks from mammoth's HTML: headings (h1–h6) open sections, paragraphs and list items are
 * blocks, table rows become one block with cells joined by " | ". Images carry no text.
 */
export function htmlBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  let trail: string[] = [];
  const path = () => (trail.length ? trail.join(SECTION_SEPARATOR) : null);
  const element = /<(h[1-6]|p|li|tr)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;

  for (const match of html.matchAll(element)) {
    const tag = (match[1] ?? "").toLowerCase();
    const inner = match[2] ?? "";
    if (tag === "tr") {
      const cells = [...inner.matchAll(/<t[dh](?:\s[^>]*)?>([\s\S]*?)<\/t[dh]>/gi)]
        .map((cell) => inlineText(cell[1] ?? ""))
        .filter(Boolean);
      if (cells.length) blocks.push({ sectionPath: path(), text: cells.join(" | ") });
      continue;
    }
    const text = inlineText(inner);
    if (!text) continue;
    if (tag.startsWith("h")) {
      trail = headingTrail(trail, Number(tag.slice(1)), text);
      blocks.push({ sectionPath: path(), text });
    } else {
      blocks.push({ sectionPath: path(), text: tag === "li" ? `• ${text}` : text });
    }
  }
  return blocks;
}

/** DOCX → pseudo-pages of about 3,000 characters that never cross a heading. */
export async function parseDocx(path: string): Promise<ExtractedPage[]> {
  let html: string;
  try {
    const result = await mammoth.convertToHtml(
      { path },
      { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) },
    );
    html = result.value;
  } catch (error) {
    throw new SourceRejectedError("CORRUPT_DOCX", "The DOCX file could not be read.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const pages = paginate(htmlBlocks(html));
  if (pages.length === 0) {
    throw new SourceRejectedError("EMPTY_FILE", "The document has no text.");
  }
  return pages;
}
