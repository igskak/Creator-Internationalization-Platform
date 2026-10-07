import { countChars } from "@rc/templates";
import type { ValidationIssue, Validator } from "./types";

/** Instagram caption limit. */
export const MAX_CAPTION_CHARS = 2200;
export const MIN_HASHTAGS = 3;
/** Policy; the API allows 30 (⚠ V-05). */
export const MAX_HASHTAGS = 5;
const KEYWORD_CTA_TYPES = new Set(["COMMENT_KEYWORD", "DM_KEYWORD"]);
/** ManyChat keyword: capitals and digits, 3–16 characters. */
export const CTA_KEYWORD = /^[A-ZÁÉÍÓÚÑ0-9]{3,16}$/;

const URL_IN_TEXT =
  /\b(?:https?:\/\/|www\.)\S+|(?<![\p{L}\d])[\p{L}\d-]+\.(?:com|net|org|es|io|co|app|me|ly|info|shop|store)(?![\p{L}\d])/iu;
const HASHTAG = /^#[\p{L}\p{N}_]+$/u;
/** Pictographs, except the symbols that are ordinary text (©, ®, ™). */
const EMOJI = /(?![©®™])[\p{Extended_Pictographic}\p{Emoji_Presentation}]/u;

/** Caption length, hashtags, CTA keyword, no URLs or emoji in slides. */
export const validateTextRules: Validator = (draft) => {
  const issues: ValidationIssue[] = [];

  const captionChars = countChars(draft.caption);
  if (captionChars > MAX_CAPTION_CHARS) {
    issues.push({
      code: "CAPTION_TOO_LONG",
      severity: "BLOCKER",
      fieldPath: "caption",
      message: `The caption has ${captionChars} characters, the limit is ${MAX_CAPTION_CHARS}.`,
      fixHint: `Shorten the caption to ${MAX_CAPTION_CHARS} characters or fewer.`,
    });
  }

  if (draft.hashtags.length < MIN_HASHTAGS || draft.hashtags.length > MAX_HASHTAGS) {
    issues.push({
      code: "HASHTAG_COUNT",
      severity: "MAJOR",
      fieldPath: "hashtags",
      message: `${draft.hashtags.length} hashtags, the policy is ${MIN_HASHTAGS}–${MAX_HASHTAGS}.`,
      fixHint: `Use ${MIN_HASHTAGS} to ${MAX_HASHTAGS} hashtags.`,
    });
  }
  const seen = new Set<string>();
  draft.hashtags.forEach((tag, i) => {
    if (!HASHTAG.test(tag)) {
      issues.push({
        code: "HASHTAG_FORMAT",
        severity: "MAJOR",
        fieldPath: `hashtags.${i}`,
        message: `"${tag}" is not a valid hashtag.`,
        fixHint: "Start with # and use letters, digits or underscores only, without spaces.",
      });
    }
    const key = tag.toLowerCase();
    if (seen.has(key)) {
      issues.push({
        code: "HASHTAG_DUPLICATE",
        severity: "MINOR",
        fieldPath: `hashtags.${i}`,
        message: `"${tag}" is repeated.`,
        fixHint: "Remove the duplicate.",
      });
    }
    seen.add(key);
  });

  const { cta } = draft;
  if (KEYWORD_CTA_TYPES.has(cta.type) && !cta.keyword) {
    issues.push({
      code: "CTA_KEYWORD_MISSING",
      severity: "BLOCKER",
      fieldPath: "cta",
      message: `The CTA type ${cta.type} needs a keyword.`,
      fixHint: "Add a keyword of 3–16 capitals or digits.",
    });
  }
  if (cta.keyword && !CTA_KEYWORD.test(cta.keyword)) {
    issues.push({
      code: "CTA_KEYWORD_INVALID",
      severity: "BLOCKER",
      fieldPath: "cta",
      message: `The keyword "${cta.keyword}" must be 3–16 capitals or digits.`,
      fixHint: "Use capitals and digits only, for example RISOTTO.",
    });
  }

  for (const slide of draft.slides) {
    for (const [slot, text] of Object.entries(slide.slots)) {
      const fieldPath = `slides.${slide.id}.slots.${slot}`;
      if (URL_IN_TEXT.test(text)) {
        issues.push({
          code: "URL_IN_SLIDE",
          severity: "BLOCKER",
          fieldPath,
          message: "A slide contains a link.",
          fixHint: "Links belong in the bio or a DM flow, not on slides.",
        });
      }
      if (EMOJI.test(text)) {
        issues.push({
          code: "EMOJI_IN_SLIDE",
          severity: "BLOCKER",
          fieldPath,
          message: "A slide contains an emoji.",
          fixHint: "Emoji are allowed in the caption only.",
        });
      }
    }
  }
  return issues;
};
