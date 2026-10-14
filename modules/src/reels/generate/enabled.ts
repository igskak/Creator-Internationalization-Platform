import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { InvalidStateError } from "@rc/lib/errors";
import type { ServiceContext } from "../../core";

// The kill switch of Reel generation (`app_settings` key `reels.enabled`, M8-06). Missing means
// off: nothing is spent on shots until the owner turns it on in Settings.

export async function reelsEnabled(ctx: ServiceContext): Promise<boolean> {
  const [row] = await ctx.db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, "reels.enabled"));
  return row?.value === true;
}

export async function assertReelsEnabled(ctx: ServiceContext): Promise<void> {
  if (!(await reelsEnabled(ctx))) {
    throw new InvalidStateError("Reel generation is switched off in Settings.", {
      details: { code: "reels_disabled" },
    });
  }
}
