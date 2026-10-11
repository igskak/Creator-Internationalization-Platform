import type { ApprovedSnapshot } from "@rc/db/json";

// The text Instagram receives: the approved caption and its hashtags (plan 09 §9.4, M5-06).
// Limits are Meta's (V-05, verified 2026-10-11): 2,200 characters, 30 hashtags, 20 @ tags.

export const MAX_CAPTION_CHARS = 2200;
export const MAX_CAPTION_HASHTAGS = 30;
export const MAX_CAPTION_MENTIONS = 20;

/** The caption, a blank line, then the hashtags in one line. */
export function composeCaption(snapshot: Pick<ApprovedSnapshot, "caption" | "hashtags">): string {
  const tags = snapshot.hashtags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
  const caption = snapshot.caption.trim();
  return tags ? `${caption}\n\n${tags}` : caption;
}

export type CaptionStats = { chars: number; hashtags: number; mentions: number };

/** Characters are counted as code points, which is how Instagram counts emoji and accents. */
export function captionStats(caption: string): CaptionStats {
  return {
    chars: [...caption].length,
    hashtags: caption.match(/(?:^|\s)#[\p{L}\p{N}_]+/gu)?.length ?? 0,
    mentions: caption.match(/(?:^|\s)@[\p{L}\p{N}_.]+/gu)?.length ?? 0,
  };
}

/** What is wrong with a caption for Instagram, in words; empty when it is fine. */
export function captionProblems(caption: string): string[] {
  const stats = captionStats(caption);
  const problems: string[] = [];
  if (stats.chars === 0) problems.push("The caption is empty.");
  if (stats.chars > MAX_CAPTION_CHARS) {
    problems.push(
      `The caption with its hashtags has ${stats.chars} characters, Instagram allows ${MAX_CAPTION_CHARS}.`,
    );
  }
  if (stats.hashtags > MAX_CAPTION_HASHTAGS) {
    problems.push(
      `The caption has ${stats.hashtags} hashtags, Instagram allows ${MAX_CAPTION_HASHTAGS}.`,
    );
  }
  if (stats.mentions > MAX_CAPTION_MENTIONS) {
    problems.push(
      `The caption has ${stats.mentions} @ tags, Instagram allows ${MAX_CAPTION_MENTIONS}.`,
    );
  }
  return problems;
}

/** Whitespace-insensitive form, to recognize our own post in a list of recent media. */
export const normalizeCaption = (caption: string): string =>
  caption
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
