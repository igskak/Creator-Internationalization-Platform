import { z } from "zod";

// JSON column shapes for 0009_reels (plan 18 §18.3, style: docs/design/reel-style.md). The Reel
// director prompt (M8-03) produces these and services validate them on every write.

export const REEL_SCENE_ROLES = ["HOOK", "RULE", "STEP", "PEAK", "PAYOFF", "CTA"] as const;
export const ReelSceneRole = z.enum(REEL_SCENE_ROLES);
export type ReelSceneRole = z.infer<typeof ReelSceneRole>;

/** One emotion per scene (the owner's brief, 2026-10-13). */
export const REEL_EMOTIONS = [
  "DOUBT",
  "INTRIGUE",
  "SURPRISE",
  "AHA",
  "APPETITE",
  "DELIGHT",
  "RELIEF",
  "USEFULNESS",
  "SAVE_IT",
] as const;
export const ReelEmotion = z.enum(REEL_EMOTIONS);
export type ReelEmotion = z.infer<typeof ReelEmotion>;

/** Words of a card without the `**` accent marks. */
export function cardWords(card: string): string[] {
  return card.replaceAll("**", "").split(/\s+/).filter(Boolean);
}
const MAX_CARD_WORDS = 6;
const Card = z
  .string()
  .min(1)
  .refine((s) => cardWords(s).length <= MAX_CARD_WORDS, {
    message: `A card has at most ${MAX_CARD_WORDS} words.`,
  });

/** reel_scripts.hook_options[]: three hooks, each a doubt about a familiar action and the rule. */
export const ReelHookOption = z.object({
  id: z.string().min(1),
  /** Taxonomy code of the hook formula (e.g. WRONG_WAY_RIGHT_WAY). */
  formula: z.string().min(1),
  /** The first card, e.g. "HOT WATER ON **BULGUR?**". */
  card: Card,
  /** The card that opens the loop, e.g. "ONLY IF IT'S **FINE.**". */
  ruleCard: Card,
  rationale: z.string().min(1),
});
export type ReelHookOption = z.infer<typeof ReelHookOption>;

/** reel_scripts.scenes[]. */
export const ReelScene = z.object({
  /** Stable across edits; shots and renders refer to it. */
  id: z.string().min(1),
  index: z.number().int().nonnegative(),
  role: ReelSceneRole,
  emotion: ReelEmotion,
  /** Length on the 120 BPM grid in beats of 0.5 s: 3 to 5, halves allowed (1.5 to 2.5 s). */
  beats: z.number().min(3).max(5).multipleOf(0.5),
  /** Card text; `**…**` marks the accent. At most 6 words. */
  card: Card,
  /** For the video model: "static camera" plus one concrete motion; no text, no people. */
  shotPrompt: z.string().min(1),
  /** The picture the shot starts from (`visual_assets.id`). */
  sourcePictureId: z.string().min(1),
  /** RIGHT: a box flush right with the top free for the card; FULL: full bleed. */
  layout: z.enum(["RIGHT", "FULL"]),
  /** Ids of the source carousel's slides this scene's claim comes from. Empty = no claim. */
  claimSlideIds: z.array(z.string().min(1)),
  /** `reel_shots.id`, set when the shot exists (it may belong to another market's Reel). */
  shotId: z.string().min(1).optional(),
});
export type ReelScene = z.infer<typeof ReelScene>;

export const REEL_AUDIO_KINDS = ["NONE", "PLACEHOLDER_BEAT", "OWNER_TRACK"] as const;
export const ReelAudioKind = z.enum(REEL_AUDIO_KINDS);
export type ReelAudioKind = z.infer<typeof ReelAudioKind>;

/** reel_renders.qa_report (plan 18 §18.4 step 4). */
export const ReelQaReport = z.object({
  durationMs: z.number().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  videoCodec: z.string(),
  audioCodec: z.string().nullable(),
  fileBytes: z.number().int().nonnegative(),
  /** Frames that are (almost) black; a warning above zero. */
  blackFrames: z.number().int().nonnegative(),
  /** True when every card sits inside the safe zone (y 230–1440, right 230 px clear). */
  safeZoneOk: z.boolean(),
  lowContrast: z
    .array(z.object({ sceneId: z.string(), ratio: z.number().nonnegative() }))
    .optional(),
  /** Mean frame difference in the first second (0–255); low means a static opening. */
  firstSecondMotion: z.number().nonnegative(),
  warnings: z.array(z.string()),
});
export type ReelQaReport = z.infer<typeof ReelQaReport>;
