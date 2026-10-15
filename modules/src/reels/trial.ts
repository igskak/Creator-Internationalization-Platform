import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { ForbiddenError, InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import { audit, type ServiceContext } from "../core";

// Trial Reels (M8-11, plan 18): a Reel can go out as a trial, shown to non-followers first. Off by
// default. Instagram takes it as `trial_params.graduation_strategy` on the REELS container (IG User
// Media reference, read 2026-10-15): MANUAL = graduated by hand in the Instagram app (the API has no
// call for it), SS_PERFORMANCE = Instagram graduates it when it does well. The choice is kept on
// the Reel variant and read by the publisher when it makes the container, so it can be changed until
// the Reel starts going out.

export const TRIAL_GRADUATIONS = ["MANUAL", "SS_PERFORMANCE"] as const;
export type TrialGraduation = (typeof TRIAL_GRADUATIONS)[number];

export const SetReelTrialInput = z.object({
  variantId: z.uuid(),
  /** Null: a normal Reel. */
  graduation: z.enum(TRIAL_GRADUATIONS).nullable(),
});

/** Statuses in which the post is going out or out already: the choice is fixed then. */
const FIXED = new Set(["PUBLISHING", "PUBLISHED"]);

export async function setReelTrial(
  ctx: ServiceContext,
  raw: z.input<typeof SetReelTrialInput>,
): Promise<{ trialGraduation: TrialGraduation | null }> {
  if (ctx.actor.type === "USER" && ctx.actor.role === "chef") throw new ForbiddenError();
  const parsed = SetReelTrialInput.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const { variantId, graduation } = parsed.data;
  const [variant] = await ctx.db
    .select()
    .from(schema.contentVariants)
    .where(eq(schema.contentVariants.id, variantId));
  if (!variant) throw new NotFoundError("Reel not found.");
  if (variant.format !== "REEL") throw new ValidationError("Only a Reel can be a trial.");
  if (FIXED.has(variant.status)) {
    throw new InvalidStateError(
      "The Reel is going out or out already; its trial setting is fixed.",
    );
  }
  await ctx.db
    .update(schema.contentVariants)
    .set({ trialGraduation: graduation })
    .where(eq(schema.contentVariants.id, variantId));
  await audit(ctx, {
    action: "reel.trial_set",
    entityType: "content_variant",
    entityId: variantId,
    marketId: variant.marketId,
    data: { from: variant.trialGraduation ?? null, to: graduation },
  });
  return { trialGraduation: graduation };
}
