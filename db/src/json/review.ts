import { z } from "zod";
import { CtaSpec, Slide, UtmSpec } from "./content";

// JSON column shapes for 0006_review_scheduling (plan 04 §4.4). Services validate with these on
// every write.

/**
 * content_variant_versions.snapshot: the exact content a reviewer approved, bound to one render
 * [S§19]. Immutable once written; the scheduler and the publisher read it, never the live variant.
 */
/** What is added because the post uses generated images (M5-12): decided at approval, part of the snapshot. */
export const AI_DISCLOSURE_MODES = [
  "NONE",
  "CAPTION_NOTE",
  "SLIDE_BADGE",
  "PLATFORM_LABEL",
] as const;
export const SnapshotDisclosure = z.object({
  mode: z.enum(AI_DISCLOSURE_MODES),
  /** Appended to the caption (CAPTION_NOTE). */
  captionNote: z.string().min(1).optional(),
  /** The slides with generated images carry a badge (SLIDE_BADGE); it is part of the render. */
  badge: z.boolean().optional(),
  /** Instagram's AI info label is requested at publishing (PLATFORM_LABEL). */
  platformLabel: z.boolean().optional(),
});
export type SnapshotDisclosure = z.infer<typeof SnapshotDisclosure>;

/** What a Reel's approval froze (M8-09): the exact video file and the script it was made from. */
export const ApprovedReel = z.object({
  /** `reel_renders.id`, the same as the snapshot's `renderId`. */
  renderId: z.string().min(1),
  scriptId: z.string().min(1),
  scriptVersion: z.number().int().positive(),
  chosenHookId: z.string().min(1).nullable(),
  /** The carousel the Reel was made from. */
  sourceVariantId: z.string().min(1).nullable(),
  /** The mp4 in storage and its SHA-256: the publisher checks the file is still this one. */
  videoKey: z.string().min(1),
  sha256: z.string().min(1),
  bytes: z.number().int().positive(),
  durationMs: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  audioKind: z.string().min(1),
  /** The text cards in order, as approved (what the viewer reads). */
  cards: z.array(z.string()),
});
export type ApprovedReel = z.infer<typeof ApprovedReel>;

export const ApprovedSnapshot = z.object({
  /** Absent on carousels approved before M8-09. A Reel has no slides and carries `reel`. */
  format: z.enum(["CAROUSEL", "REEL"]).optional(),
  hook: z.string(),
  hookType: z.string(),
  caption: z.string(),
  cta: CtaSpec,
  hashtags: z.array(z.string()),
  slides: z.array(Slide),
  visualStyle: z.string(),
  templateSequence: z.array(z.string()),
  offerId: z.string().min(1).optional(),
  campaignId: z.string().min(1).optional(),
  utm: UtmSpec.optional(),
  renderId: z.string().min(1),
  renderedSlideKeys: z.array(z.string()),
  knowledge: z.array(z.object({ id: z.string().min(1), version: z.number().int().positive() })),
  generationVersion: z.string(),
  disclosure: SnapshotDisclosure.optional(),
  reel: ApprovedReel.optional(),
});
export type ApprovedSnapshot = z.infer<typeof ApprovedSnapshot>;

export const INSTAGRAM_ERROR_CLASSES = [
  "TRANSIENT",
  "RATE_LIMIT",
  "AUTH",
  "PERMISSION",
  "INVALID_MEDIA",
  "PERMANENT",
  "UNKNOWN",
] as const;

/** publications.last_error (09 §9.5): a Graph API failure, with no token or URL in it. */
export const InstagramError = z.object({
  httpStatus: z.number().int().optional(),
  code: z.number().int().optional(),
  subcode: z.number().int().optional(),
  type: z.string().optional(),
  message: z.string(),
  fbtraceId: z.string().optional(),
  classification: z.enum(INSTAGRAM_ERROR_CLASSES),
});
export type InstagramError = z.infer<typeof InstagramError>;

/** social_accounts.last_health: the result of the last health check. */
export const AccountHealthSnapshot = z.object({
  ok: z.boolean(),
  quotaUsage: z.number().int().nonnegative().optional(),
  quotaTotal: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});
export type AccountHealthSnapshot = z.infer<typeof AccountHealthSnapshot>;
