import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import type { ServiceContext } from "../core";

/** The kill switch (`publishing.enabled`, plan 09 §9.8). Missing means off: nothing publishes by default. */
export async function isPublishingEnabled(ctx: ServiceContext): Promise<boolean> {
  const [row] = await ctx.db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, "publishing.enabled"));
  return row?.value === true;
}
