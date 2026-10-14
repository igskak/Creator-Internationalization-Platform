import { z } from "zod";

// reel-director (plan 18 §18.4, docs/design/reel-style.md, M8-03): the input and the answer of the
// stage that turns one approved carousel into the script of one Reel. The answer is structural
// here (types, enums built from the input); counts, word limits, the beat grid and the facts are
// checked by the validators in modules/src/reels, so a violation gives a repair message and not a
// parse failure. Arrays have no length limits here: structured output only allows 0 or 1 as a
// minimum. The role and emotion codes are those of db/src/json/reels.ts (a test keeps them equal).

export const REEL_SCENE_ROLES = ["HOOK", "RULE", "STEP", "PEAK", "PAYOFF", "CTA"] as const;
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
export const REEL_LAYOUTS = ["RIGHT", "FULL"] as const;
export const FLASH_OPENER = ["ON", "OFF"] as const;

/** Limits of the script (reel-style.md); the validators and the prompt read them from here. */
export const REEL_LIMITS = {
  minScenes: 6,
  maxScenes: 9,
  minSeconds: 12,
  maxSeconds: 20,
  /** One beat is half a second (120 BPM); a scene is 3 to 5 beats, in steps of half a beat. */
  secondsPerBeat: 0.5,
  minBeats: 3,
  maxBeats: 5,
  hookOptions: 3,
  maxCardWords: 6,
  /** A card is 2 to 3 lines in a 780 px column at 92 to 128 px; these keep it from overflowing. */
  maxCardChars: 36,
  maxCardWordChars: 14,
} as const;

const Slide = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  /** All text of the slide, slots joined, as the reader sees it. */
  text: z.string(),
  factual: z.boolean(),
  /** Ids of the knowledge cards the slide rests on; context for the director, not a source. */
  knowledgeIds: z.array(z.string().min(1)).default([]),
});

const Picture = z.object({
  /** `visual_assets.id`. */
  id: z.string().min(1),
  slideId: z.string().min(1),
  /** What the picture shows, in a sentence (the slide's alt text or the generation subject). */
  description: z.string().min(1),
});

const Term = z.object({ code: z.string().min(1), label: z.string() });

export const ReelDirectorScene = z.object({
  id: z.string().min(1),
  role: z.enum(REEL_SCENE_ROLES),
  emotion: z.enum(REEL_EMOTIONS),
  beats: z.number(),
  card: z.string(),
  shotPrompt: z.string(),
  sourcePictureId: z.string().min(1),
  layout: z.enum(REEL_LAYOUTS),
  claimSlideIds: z.array(z.string().min(1)),
});
export type ReelDirectorScene = z.infer<typeof ReelDirectorScene>;

export const ReelDirectorHook = z.object({
  id: z.string().min(1),
  hookType: z.string().min(1),
  card: z.string(),
  ruleCard: z.string(),
  claimSlideIds: z.array(z.string().min(1)),
  rationale: z.string(),
});
export type ReelDirectorHook = z.infer<typeof ReelDirectorHook>;

export const ReelDirectorInput = z.object({
  market: z.object({
    code: z.string().min(1),
    displayName: z.string().min(1),
    language: z.string().min(1),
  }),
  carousel: z.object({
    /** The hook line and hook type of the carousel this Reel is built from. */
    hook: z.string(),
    hookType: z.string().min(1),
    slides: z.array(Slide).min(1),
  }),
  /** The carousel's pictures a shot may start from. */
  pictures: z.array(Picture).min(1),
  brief: z.object({
    tone: z.string(),
    terminology: z.array(z.object({ concept: z.string(), localTerm: z.string() })).default([]),
    ctaType: z.string().min(1),
  }),
  taxonomy: z.object({ hookTypes: z.array(Term).min(1) }),
  /** Hook types of this market's latest Reels, newest first, so the options do not repeat them. */
  recentHookTypes: z.array(z.string().min(1)).default([]),
  /**
   * The script of another market's Reel of the same idea. The shots are reused (decision Q-10), so
   * the scenes stay as they are and only the cards are written for this market.
   */
  baseScript: z
    .object({
      chosenHookType: z.string().min(1),
      scenes: z.array(ReelDirectorScene).min(1),
    })
    .optional(),
});
export type ReelDirectorInput = z.infer<typeof ReelDirectorInput>;

const answerShape = {
  hookOptions: z.array(ReelDirectorHook),
  chosenHookId: z.string().min(1),
  flashOpener: z.enum(FLASH_OPENER),
  scenes: z.array(ReelDirectorScene),
};

/** Structural schema of the answer. */
export const ReelDirectorOutput = z.object(answerShape);
export type ReelDirectorOutput = z.infer<typeof ReelDirectorOutput>;

const oneOf = (codes: readonly string[]) =>
  z.enum(codes as [string, ...string[]]) as unknown as z.ZodType<string>;

/**
 * The schema for one call: hook types, slide ids and picture ids are the ones given, so the model
 * cannot answer with a code or an id that does not exist.
 */
export function reelDirectorOutputFor(input: ReelDirectorInput): z.ZodType<ReelDirectorOutput> {
  const slideId = oneOf(input.carousel.slides.map((s) => s.id));
  const pictureId = oneOf(input.pictures.map((p) => p.id));
  return z.object({
    ...answerShape,
    hookOptions: z.array(
      ReelDirectorHook.extend({
        hookType: oneOf(input.taxonomy.hookTypes.map((t) => t.code)),
        claimSlideIds: z.array(slideId),
      }),
    ),
    scenes: z.array(
      ReelDirectorScene.extend({ sourcePictureId: pictureId, claimSlideIds: z.array(slideId) }),
    ),
  });
}
