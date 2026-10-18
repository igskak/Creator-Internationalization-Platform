import type { ApprovedSnapshot, YouTubeMetadata, YouTubePrivacyStatus } from "@rc/db/json";

// What a Short is uploaded with (docs/design/youtube-shorts.md "What is sent"): the Reel's hook
// line as the title, its approved caption without the asks that only work on Instagram, the
// Reel's hashtags and #Shorts. Limits are YouTube's (V-31): title ≤ 100 characters, description
// ≤ 5,000 bytes, neither with `<` or `>`, tags ≤ 500 characters.

export const MAX_TITLE_CHARS = 100;
export const MAX_DESCRIPTION_BYTES = 5000;
export const MAX_TAGS_CHARS = 500;
/** Howto & Style. */
export const SHORTS_CATEGORY_ID = "26";
export const SHORTS_TAG = "#Shorts";

/**
 * Sentences that ask for something only Instagram has: the bio link, DMs and keyword comments
 * (the DM automation), the carousel's swipe, saving or sending "this" post, following the account.
 * English only: the YouTube channel is the English market's (G-09).
 */
const INSTAGRAM_ONLY = [
  /\blink in (?:my |our |the )?bio\b/iu,
  /\bDMs?\b/u,
  /\bdirect messages?\b/iu,
  /\bcomment\s+["“'«]?[A-Z]{2,}\b/u,
  /\binstagram\b|\binsta\b/iu,
  /\bIG\b/u,
  /\bswipe\b/iu,
  /\b(?:save|send|share)\s+(?:this|it)\b/iu,
  // "Follow for more", not "follow the recipe".
  /\bfollow\s+(?:us|me|along|for\b|the account|this account|@)/iu,
  /\bdouble[- ]tap\b/iu,
  /\b(?:in|on) (?:my|our) (?:stories|story|highlights|feed|grid)\b/iu,
  /\bthis (?:reel|post|carousel)\b/iu,
];

/** The source brand must never appear on an independent account (decision 2026-10-10). */
const BRAND_TEXT = /reg\s*\.?\s*chef/iu;

const fold = (text: string): string => text.replace(/\s+/gu, " ").trim();
const noAngles = (text: string): string => text.replace(/[<>]/gu, "");
const paragraphs = (text: string): string[] =>
  text
    .replace(/\r\n?/gu, "\n")
    .split(/\n\s*\n/u)
    .map((p) => p.trim())
    .filter(Boolean);
const sentences = (paragraph: string): string[] =>
  paragraph.split(/(?<=[.!?…])\s+/u).filter((s) => s.trim() !== "");

/** Cuts at a word so that the text has at most `max` characters (code points), with "…". */
export function cutAtWord(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  const head = chars.slice(0, max - 1).join("");
  const space = head.lastIndexOf(" ");
  return `${(space > max / 2 ? head.slice(0, space) : head).replace(/[\s,;:–—-]+$/u, "")}…`;
}

/** The Reel's hook line: the caption's first paragraph (G-01 writes it from the chosen hook). */
export function shortTitle(snapshot: Pick<ApprovedSnapshot, "caption" | "hook">): string {
  const first = paragraphs(snapshot.caption)[0] ?? "";
  const line = fold(noAngles(first)) || fold(noAngles(snapshot.hook));
  return cutAtWord(line, MAX_TITLE_CHARS);
}

const isInstagramOnly = (sentence: string): boolean =>
  INSTAGRAM_ONLY.some((pattern) => pattern.test(sentence));

/** `#Rice` → `#Rice`, `rice` → `#rice`; duplicates (any case) and `#Shorts` itself are dropped. */
function hashtagLine(tags: readonly string[]): string {
  const seen = new Set<string>([SHORTS_TAG.toLowerCase()]);
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().startsWith("#") ? raw.trim() : `#${raw.trim()}`;
    if (tag.length < 2 || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return [...out, SHORTS_TAG].join(" ");
}

/**
 * The caption after its first line, without the approved ask (`cta.text`, the last sentence by
 * G-01's rule) and without sentences that only work on Instagram; then the market's AI note, if
 * the snapshot has one; then the hashtags and #Shorts.
 */
export function shortDescription(
  snapshot: Pick<ApprovedSnapshot, "caption" | "cta" | "hashtags"> &
    Partial<Pick<ApprovedSnapshot, "disclosure">>,
): string {
  const ask = fold(snapshot.cta.text);
  const body = paragraphs(snapshot.caption)
    .slice(1)
    .map((p) =>
      sentences(p)
        .filter((s) => !(ask && fold(s) === ask) && !isInstagramOnly(s))
        .join(" "),
    )
    .map((p) => (ask ? p.replace(ask, "").trim() : p))
    .filter(Boolean);
  return noAngles(
    [...body, snapshot.disclosure?.captionNote, hashtagLine(snapshot.hashtags)]
      .filter((part): part is string => Boolean(part?.trim()))
      .join("\n\n"),
  );
}

/** The Reel's hashtags as tags (without `#`), as many as fit in 500 characters. */
export function shortTags(hashtags: readonly string[]): string[] {
  const tags: string[] = [];
  let used = 0;
  for (const raw of hashtags) {
    const tag = noAngles(raw.replace(/^#/u, "").trim());
    if (!tag || tags.some((t) => t.toLowerCase() === tag.toLowerCase())) continue;
    // Commas count, and a tag with a space counts its quotation marks (V-31).
    const cost = tag.length + (tag.includes(" ") ? 2 : 0) + (tags.length > 0 ? 1 : 0);
    if (used + cost > MAX_TAGS_CHARS) break;
    used += cost;
    tags.push(tag);
  }
  return tags;
}

export function buildShortMetadata(
  snapshot: ApprovedSnapshot,
  options: { language: string; privacyStatus: YouTubePrivacyStatus },
): YouTubeMetadata {
  return {
    title: shortTitle(snapshot),
    description: shortDescription(snapshot),
    tags: shortTags(snapshot.hashtags),
    categoryId: SHORTS_CATEGORY_ID,
    defaultLanguage: options.language,
    privacyStatus: options.privacyStatus,
    selfDeclaredMadeForKids: false,
    // Every shot of a Reel is AI-animated from our pictures: realistic synthetic content.
    containsSyntheticMedia: true,
  };
}

/** What is wrong with the metadata for YouTube or for an independent account; empty when fine. */
export function metadataProblems(metadata: YouTubeMetadata): string[] {
  const problems: string[] = [];
  const titleChars = [...metadata.title].length;
  if (titleChars === 0) problems.push("The title is empty.");
  if (titleChars > MAX_TITLE_CHARS) {
    problems.push(`The title has ${titleChars} characters, YouTube allows ${MAX_TITLE_CHARS}.`);
  }
  const bytes = new TextEncoder().encode(metadata.description).byteLength;
  if (bytes > MAX_DESCRIPTION_BYTES) {
    problems.push(`The description has ${bytes} bytes, YouTube allows ${MAX_DESCRIPTION_BYTES}.`);
  }
  if (/[<>]/u.test(metadata.title + metadata.description)) {
    problems.push("The title or description contains < or >, which YouTube refuses.");
  }
  if (!metadata.description.includes(SHORTS_TAG)) problems.push("The description has no #Shorts.");
  if ([metadata.title, metadata.description, ...metadata.tags].some((t) => BRAND_TEXT.test(t))) {
    problems.push("The text names the source brand; the accounts are independent.");
  }
  return problems;
}

/** The brand check alone, for the guard's own error code. */
export const namesSourceBrand = (metadata: YouTubeMetadata): boolean =>
  [metadata.title, metadata.description, ...metadata.tags].some((t) => BRAND_TEXT.test(t));
