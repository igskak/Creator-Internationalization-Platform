import { z } from "zod";
import { definePrompt } from "../define";
import { renderSections, section } from "../xml";
import {
  type ReelDirectorHook,
  ReelDirectorInput,
  ReelDirectorOutput,
  type ReelDirectorScene,
  reelDirectorOutputFor,
} from "./schema";
import v1 from "./v1";

// reel-director@2 (docs/growth/instagram-growth-strategy.md, task G-01): reel-director@1 plus the
// Reel's own post. The answer adds "caption" (the text under the video, without its first line:
// the system writes that line from the chosen hook, so changing the hook keeps the caption true),
// "cta" (one ask; a Reel reaches people who do not follow the account, so it prefers SHARE or
// FOLLOW and rotates against the market's recent asks) and 3 to 5 "hashtags" that do not repeat the
// recent posts' block. The flash opener is ON by default (the owner's accepted reference Reel).
// A released version file is never edited: change it in v3.ts.

/** Limits of the Reel's post; the validators and the prompt read them from here. */
export const REEL_POST_LIMITS = {
  /** The caption the director writes, without the hook line, the AI note and the hashtags. */
  maxCaptionChars: 1500,
  minHashtags: 3,
  /** Instagram's cap since December 2025. */
  maxHashtags: 5,
  /** Tags of <recent_hashtags> a new set may reuse. */
  maxRecentHashtags: 2,
} as const;

const Term = z.object({ code: z.string().min(1), label: z.string() });

export const ReelPostCta = z.object({
  /** `cta_type` taxonomy code, one of <cta_types>. */
  type: z.string().min(1),
  /** The ask, the caption's last sentence. */
  text: z.string(),
  /** Kept from the carousel for COMMENT_KEYWORD and DM_KEYWORD. */
  keyword: z.string().min(1).optional(),
});
export type ReelPostCta = z.infer<typeof ReelPostCta>;

export const ReelDirectorInputV2 = ReelDirectorInput.extend({
  carousel: ReelDirectorInput.shape.carousel.extend({
    /** The carousel's caption: the facts the Reel's caption may retell, nothing more. */
    caption: z.string(),
    cta: ReelPostCta,
  }),
  /**
   * The asks the Reel may use. One code only when the carousel's ask is tied to an offer or a
   * keyword: the Reel then keeps it.
   */
  ctaTypes: z.array(Term).min(1),
  /** Ask types of this market's latest posts, newest first. */
  recentCtaTypes: z.array(z.string().min(1)).default([]),
  /** Hashtags of this market's latest posts, the most used first. */
  recentHashtags: z.array(z.string().min(1)).default([]),
});
export type ReelDirectorInputV2 = z.infer<typeof ReelDirectorInputV2>;

const postShape = {
  caption: z.string(),
  cta: ReelPostCta,
  hashtags: z.array(z.string()),
};

export const ReelDirectorOutputV2 = ReelDirectorOutput.extend(postShape);
export type ReelDirectorOutputV2 = z.infer<typeof ReelDirectorOutputV2>;

const oneOf = (codes: readonly string[]) =>
  z.enum(codes as [string, ...string[]]) as unknown as z.ZodType<string>;

/** v1's schema for one call plus the post; the ask type is one of the given codes. */
export function reelDirectorV2OutputFor(
  input: ReelDirectorInputV2,
): z.ZodType<ReelDirectorOutputV2> {
  const base = reelDirectorOutputFor(input) as unknown as z.ZodObject<{
    hookOptions: z.ZodArray<typeof ReelDirectorHook>;
    chosenHookId: z.ZodString;
    flashOpener: z.ZodType<"ON" | "OFF">;
    scenes: z.ZodArray<typeof ReelDirectorScene>;
  }>;
  return base.extend({
    ...postShape,
    cta: ReelPostCta.extend({ type: oneOf(input.ctaTypes.map((t) => t.code)) }),
  }) as unknown as z.ZodType<ReelDirectorOutputV2>;
}

const L = REEL_POST_LIMITS;

const POST_RULES = `# Post
The Reel is posted with its own caption, ask and hashtags, written for a video and for a viewer who does not follow the account yet.
- "caption": the text under the video WITHOUT its first line. The system writes the first line from the chosen hook (its card, then its rule card) and puts your caption after a blank line, so do not open by repeating the hook. Write 2 to 4 short paragraphs: the method or the reason in plain words, then the ask as the last sentence. At most ${L.maxCaptionChars} characters.
- Closed book here too: the caption retells only what <carousel> says (its slides and its <caption>), with the same numbers and units. Nothing new.
- It is a video: never mention swiping, slides, a carousel or "the post", and no arrows pointing at it. No hashtags and no links in the caption, at most two emoji.
- No engagement bait: no "comment YES", no "tag a friend", no "double tap", no joke that begs for the tap ("the Save button won't press itself").
- "cta": one ask. "type" is a code from <cta_types>; "text" is the caption's last sentence, word for word. A Reel is how new people find the account: prefer SHARE (send it to the one person who needs it, named by the situation: "Send this to whoever cooks the rice at home") or FOLLOW (more rules like this one), and do not use the type of the first entries of <recent_cta_types> when another code fits. When <cta_types> has one code only, use it, and with a keyword keep "keyword" exactly as in the carousel's <cta>.
- "hashtags": ${L.minHashtags} to ${L.maxHashtags} (Instagram allows five), each starting with # and made of letters, digits or underscores only, no repeats, in the market's language where people search in it: one or two for this dish or ingredient, one or two for the technique, at most one broad tag. Reuse at most ${L.maxRecentHashtags} of the tags in <recent_hashtags>: the same block on every post reads as automated.`;

const HOOK_PREFERENCE =
  '- A cold viewer stops for a doubt about something they already do ("Hot water on bulgur?"), answered by the rule card. When the slides support it, recommend such an option.';

const [dataRules, rules] = v1.system;
if (!dataRules || !rules) throw new Error("reel-director@1 has changed shape.");
const DATA_TAGS = "<base_script>, <task>)";
const FLASH =
  '"flashOpener": ON puts four very short flash shots under the hook card in the first second, a way to raise the first-second motion; use OFF when the hook scene is already strong.';
const CHOSEN = '- "chosenHookId" is the option you recommend.';
const OUTPUT = "# Output";
for (const anchor of [FLASH, CHOSEN, OUTPUT]) {
  if (!rules.text.includes(anchor)) throw new Error("reel-director@1 has changed shape.");
}
if (!dataRules.text.includes(DATA_TAGS)) throw new Error("reel-director@1 has changed shape.");

const DATA_RULES = dataRules.text.replace(
  DATA_TAGS,
  "<base_script>, <post>, <cta_types>, <recent_cta_types>, <recent_hashtags>, <task>)",
);
const DIRECTOR_RULES = rules.text
  .replace(
    FLASH,
    '"flashOpener": ON puts four very short flash shots under the hook card in the first second, so the viewer sees motion before they decide to stay. Use ON by default; OFF only when the hook shot itself opens on strong motion.',
  )
  .replace(CHOSEN, `${HOOK_PREFERENCE}\n${CHOSEN}`)
  .replace(OUTPUT, `${POST_RULES}\n\n${OUTPUT}`);

const postSections = (input: ReelDirectorInputV2) => [
  section(
    "post",
    [
      section("caption", input.carousel.caption),
      section("cta", input.carousel.cta.text, {
        type: input.carousel.cta.type,
        keyword: input.carousel.cta.keyword,
      }),
    ],
    { of: "carousel" },
  ),
  section(
    "cta_types",
    input.ctaTypes.map((t) => section("term", t.label, { code: t.code })),
  ),
  section(
    "recent_cta_types",
    input.recentCtaTypes.map((code, i) => section("type", "", { code, n: i + 1 })),
  ),
  section(
    "recent_hashtags",
    input.recentHashtags.map((tag) => section("tag", tag)),
  ),
];

export default definePrompt({
  id: "reel-director",
  version: 2,
  stage: "REEL_DIRECTION",
  input: ReelDirectorInputV2,
  output: ReelDirectorOutputV2,
  outputFor: reelDirectorV2OutputFor,
  defaults: v1.defaults,
  system: [
    { text: DATA_RULES, cache: false },
    { text: DIRECTOR_RULES, cache: true },
  ],
  render: (input) => {
    const { caption: _caption, cta: _cta, ...carousel } = input.carousel;
    const parts = v1.render({ ...input, carousel });
    const extra = renderSections(...postSections(input));
    // The post goes right before <task>, the last section of the message.
    return parts.map((part, i) => {
      if (i !== parts.length - 1) return part;
      const at = part.text.lastIndexOf("<task");
      if (at < 0) return { ...part, text: `${part.text}\n\n${extra}` };
      return { ...part, text: `${part.text.slice(0, at)}${extra}\n\n${part.text.slice(at)}` };
    });
  },
  renderTemplate: (v1.renderTemplate ?? "").replace(
    " <task>",
    " <post of><caption><cta type keyword>> <cta_types><term code>…> <recent_cta_types><type code n>…> <recent_hashtags><tag>…> <task>",
  ),
  changelog:
    "The Reel's own post: a caption for a video (the system writes the first line from the chosen hook), one ask that prefers SHARE or FOLLOW and rotates against the market's recent asks, 3–5 hashtags that do not repeat the recent block. Flash opener ON by default; a doubt-about-a-habit hook is recommended when the slides support it.",
});
