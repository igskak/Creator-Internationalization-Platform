import { schema } from "@rc/db";
import { RightsDefaults, type RightsPolicy, SOURCE_TYPES, type SourceType } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import type { ServiceContext } from "../../core";

/** Fallback when `rights.defaults` is missing or invalid: nothing is permitted. */
export function unknownRights(): RightsPolicy {
  return {
    use: "UNKNOWN",
    translate: "UNKNOWN",
    adapt: "UNKNOWN",
    visuallyTransform: "UNKNOWN",
    sell: "UNKNOWN",
    aiProcessing: "UNKNOWN",
    improvePrompts: "UNKNOWN",
  };
}

/**
 * The policy pre-filled on upload for a source type, from app_settings `rights.defaults`.
 * Confirmation fields are dropped: a default is never a confirmation by a person.
 */
export async function getRightsDefault(
  ctx: ServiceContext,
  type: SourceType,
): Promise<RightsPolicy> {
  const [row] = await ctx.db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, "rights.defaults"));
  const parsed = RightsDefaults.safeParse(row?.value);
  if (!parsed.success) {
    ctx.logger.warn({ type }, "rights.defaults missing or invalid; using UNKNOWN");
    return unknownRights();
  }
  const { confirmedBy: _by, confirmedAt: _at, ...policy } = parsed.data[type];
  return policy;
}

export async function getAllRightsDefaults(
  ctx: ServiceContext,
): Promise<Record<SourceType, RightsPolicy>> {
  const entries = await Promise.all(
    SOURCE_TYPES.map(async (type) => [type, await getRightsDefault(ctx, type)] as const),
  );
  return Object.fromEntries(entries) as Record<SourceType, RightsPolicy>;
}
