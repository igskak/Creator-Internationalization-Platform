import { z } from "zod";

// JSON column shapes for 0001_core (plan 04 §4.4). Services validate with these on every write.

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected a color like #1A2B3C");

export const VisualSystemColors = z.object({
  background: hexColor,
  surface: hexColor,
  text: hexColor,
  accent: hexColor,
  positive: hexColor,
  negative: hexColor,
});

/** brands.visual_system. The column default `{}` means "not configured yet". */
export const VisualSystem = z.object({
  colors: VisualSystemColors,
  /** Font family ids bundled in @rc/templates. */
  fonts: z.object({ display: z.string().min(1), body: z.string().min(1) }),
  logo: z.object({ assetKey: z.string().min(1), minHeightPx: z.number().int().positive() }),
  spacing: z.object({ safeMarginPx: z.number().int().nonnegative() }),
  /** e.g. 'warm-mediterranean' → color overrides. */
  themeVariants: z.record(z.string().min(1), VisualSystemColors.partial()).default({}),
});
export type VisualSystem = z.infer<typeof VisualSystem>;

/** markets.preferred_vocabulary[] */
export const VocabularyEntry = z.object({
  concept: z.string().min(1),
  preferred: z.string().min(1),
  avoid: z.array(z.string().min(1)).optional(),
  note: z.string().optional(),
});
export type VocabularyEntry = z.infer<typeof VocabularyEntry>;

/** markets.forbidden_patterns[]; REGEX patterns must compile (case-insensitive, unicode). */
export const ForbiddenPattern = z
  .object({
    pattern: z.string().min(1),
    kind: z.enum(["PHRASE", "REGEX"]),
    reason: z.string().min(1),
  })
  .superRefine((value, ctx) => {
    if (value.kind !== "REGEX") return;
    try {
      new RegExp(value.pattern, "iu");
    } catch {
      ctx.addIssue({ code: "custom", path: ["pattern"], message: "Invalid regular expression" });
    }
  });
export type ForbiddenPattern = z.infer<typeof ForbiddenPattern>;

/** markets.visual_hypotheses[] (spec §8.2). */
export const VisualHypothesis = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  /** taxonomy visual_style code */
  visualStyle: z.string().min(1),
  themeVariant: z.string().min(1).optional(),
  status: z.enum(["UNTESTED", "TESTING", "CONFIRMED", "REJECTED"]),
});
export type VisualHypothesis = z.infer<typeof VisualHypothesis>;

export const VocabularyList = z.array(VocabularyEntry);
export const ForbiddenPatternList = z.array(ForbiddenPattern);
export const VisualHypothesisList = z.array(VisualHypothesis);
