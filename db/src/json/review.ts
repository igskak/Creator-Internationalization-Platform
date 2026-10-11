import { z } from "zod";
import { CtaSpec, Slide, UtmSpec } from "./content";

// JSON column shapes for 0006_review_scheduling (plan 04 §4.4). Services validate with these on
// every write.

/**
 * content_variant_versions.snapshot: the exact content a reviewer approved, bound to one render
 * [S§19]. Immutable once written; the scheduler and the publisher read it, never the live variant.
 */
export const ApprovedSnapshot = z.object({
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
