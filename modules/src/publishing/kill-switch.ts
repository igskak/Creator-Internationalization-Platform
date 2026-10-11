import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { ForbiddenError, ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import { audit, type PublishMode, type ServiceContext, withTransaction } from "../core";
import { isPublishingEnabled } from "./settings";

// The kill switch and the status of publishing (plan 05 §5.8, 09 §9.8, M5-08). The environment
// decides what is possible (`INSTAGRAM_PUBLISH_MODE`, the account allowlist); the kill switch
// (`publishing.enabled`) is the owner's stop button inside that.

export const SetPublishingEnabledInput = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().min(1, "Say why.").max(500),
});

export type PublishingStatus = {
  /** What this environment allows. */
  mode: PublishMode;
  /** The owner's switch. */
  enabled: boolean;
  /** Live posts can go out now. */
  live: boolean;
  /** Instagram account ids this environment may post to (visible to owners; never secrets). */
  allowlist: readonly string[];
};

export async function getPublishingStatus(ctx: ServiceContext): Promise<PublishingStatus> {
  const mode = ctx.instagram.publishMode;
  const enabled = await isPublishingEnabled(ctx);
  return {
    mode,
    enabled,
    live: mode === "live" && enabled,
    allowlist: ctx.instagram.app?.accountAllowlist ?? [],
  };
}

/**
 * Switches publishing on or off (owner only, audited with the reason). Off stops the dispatcher
 * from releasing live posts and stops a post that is on its way before the `media_publish` call
 * (it ends as FAILED with a clear message and can be retried when publishing is on again). Dry
 * runs are not affected.
 */
export async function setPublishingEnabled(
  ctx: ServiceContext,
  raw: z.input<typeof SetPublishingEnabledInput>,
): Promise<{ enabled: boolean }> {
  if (ctx.actor.type !== "USER" || ctx.actor.role !== "owner") {
    throw new ForbiddenError("Only an owner can switch publishing on or off.");
  }
  const parsed = SetPublishingEnabledInput.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const input = parsed.data;
  return withTransaction(ctx, async (tx) => {
    const [previous] = await tx.db
      .select({ value: schema.appSettings.value })
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, "publishing.enabled"));
    await tx.db
      .insert(schema.appSettings)
      .values({
        key: "publishing.enabled",
        value: input.enabled,
        updatedBy: ctx.actor.type === "USER" ? ctx.actor.userId : null,
      })
      .onConflictDoUpdate({
        target: schema.appSettings.key,
        set: {
          value: input.enabled,
          updatedBy: ctx.actor.type === "USER" ? ctx.actor.userId : null,
        },
      });
    await audit(tx, {
      action: input.enabled ? "publishing.enabled" : "publishing.disabled",
      entityType: "app_setting",
      data: {
        key: "publishing.enabled",
        from: previous?.value === true,
        to: input.enabled,
        reason: input.reason,
        mode: ctx.instagram.publishMode,
      },
    });
    return { enabled: input.enabled };
  });
}
