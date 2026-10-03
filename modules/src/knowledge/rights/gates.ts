import type { RightsPolicy } from "@rc/db/json";
import { RightsBlockedError } from "@rc/lib/errors";

// Rights gates (plan 07 §7.13, 12 §12.4; spec §6.2). Pure functions over the source's rights:
// anything but an explicit ALLOWED blocks, so UNKNOWN is treated like DENIED.

/** The part of a source_assets row the gates read. */
export type RightsSubject = {
  id?: string;
  rights: RightsPolicy;
  rightsStatus: "UNKNOWN" | "PENDING_REVIEW" | "CLEARED" | "RESTRICTED";
};

/**
 * AI processing (sending the source to a vendor) needs `aiProcessing = ALLOWED`. A source the
 * owner marked RESTRICTED is blocked even if the flag says ALLOWED, because the two contradict.
 */
export function canProcessWithAI(source: RightsSubject): boolean {
  return source.rights.aiProcessing === "ALLOWED" && source.rightsStatus !== "RESTRICTED";
}

export function assertCanProcessWithAI(source: RightsSubject): void {
  if (canProcessWithAI(source)) return;
  throw new RightsBlockedError("AI processing is not allowed for this source.", {
    details: {
      sourceAssetId: source.id,
      aiProcessing: source.rights.aiProcessing,
      rightsStatus: source.rightsStatus,
    },
  });
}

/** Library photos may be used in generated visuals only when `visuallyTransform = ALLOWED`. */
export function canVisuallyTransform(source: RightsSubject): boolean {
  return source.rights.visuallyTransform === "ALLOWED" && source.rightsStatus !== "RESTRICTED";
}

/** Voice exemplars and prompt improvement: allowed unless `improvePrompts = DENIED` (12 §12.4). */
export function canUseAsExemplar(source: RightsSubject): boolean {
  return source.rights.improvePrompts !== "DENIED" && source.rightsStatus !== "RESTRICTED";
}
