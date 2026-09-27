import { z } from "zod";

// Rights metadata (spec §6.2, plan 04 §4.4). Source types match the 0002 enum `source_type`.

export const SOURCE_TYPES = [
  "BOOK",
  "GUIDE",
  "RECIPE",
  "INSTAGRAM_POST",
  "VIDEO",
  "TRANSCRIPT",
  "PHOTO",
  "NOTE",
  "PRODUCT_MATERIAL",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const Permission = z.enum(["ALLOWED", "DENIED", "UNKNOWN"]);
export type Permission = z.infer<typeof Permission>;

/** One flag per permission. The rights gate needs `aiProcessing = ALLOWED` (plan 12 §12.4). */
export const RightsPolicy = z.object({
  use: Permission,
  translate: Permission,
  adapt: Permission,
  visuallyTransform: Permission,
  sell: Permission,
  aiProcessing: Permission,
  improvePrompts: Permission,
  notes: z.string().optional(),
  /** app_users.id */
  confirmedBy: z.uuid().optional(),
  confirmedAt: z.iso.datetime({ offset: true }).optional(),
});
export type RightsPolicy = z.infer<typeof RightsPolicy>;

/** app_settings 'rights.defaults': the policy pre-filled on upload, per source type. */
export const RightsDefaults = z.object(
  Object.fromEntries(SOURCE_TYPES.map((type) => [type, RightsPolicy])) as Record<
    SourceType,
    typeof RightsPolicy
  >,
);
export type RightsDefaults = z.infer<typeof RightsDefaults>;
