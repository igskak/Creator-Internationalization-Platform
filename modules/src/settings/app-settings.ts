import { schema } from "@rc/db";
import { RightsDefaults } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import { audit, type ServiceContext, withTransaction } from "../core";

/** Allowed app_settings keys and their value types (04 §4.3). P1 keys (ai.*) come later. */
export const APP_SETTING_SCHEMAS = {
  "publishing.enabled": z.boolean(),
  "publishing.min_gap_minutes": z
    .number()
    .int()
    .min(0)
    .max(24 * 60),
  "analytics.min_sample": z.number().int().min(1).max(1000),
  "rights.defaults": RightsDefaults,
} as const;
export type AppSettingKey = keyof typeof APP_SETTING_SCHEMAS;
export type AppSettingValue<K extends AppSettingKey> = z.output<(typeof APP_SETTING_SCHEMAS)[K]>;

export const SetAppSettingInput = z.object({
  key: z.enum(Object.keys(APP_SETTING_SCHEMAS) as [AppSettingKey, ...AppSettingKey[]]),
  value: z.unknown(),
});

export async function listAppSettings(ctx: ServiceContext): Promise<Record<string, unknown>> {
  const rows = await ctx.db.select().from(schema.appSettings);
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

/** 05 §5.2 setAppSetting (owner): allowed keys only, value typed per key; audit `settings.changed`. */
export async function setAppSetting(
  ctx: ServiceContext,
  raw: z.input<typeof SetAppSettingInput>,
): Promise<{ key: AppSettingKey; value: unknown }> {
  const { key, value } = SetAppSettingInput.parse(raw);
  const parsed = APP_SETTING_SCHEMAS[key].safeParse(value);
  if (!parsed.success) {
    throw ValidationError.fromZod(parsed.error, `Invalid value for ${key}.`);
  }
  const updatedBy = ctx.actor.type === "USER" ? ctx.actor.userId : null;
  return withTransaction(ctx, async (tx) => {
    const [previous] = await tx.db
      .select({ value: schema.appSettings.value })
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, key));
    await tx.db
      .insert(schema.appSettings)
      .values({ key, value: parsed.data, updatedBy })
      .onConflictDoUpdate({
        target: schema.appSettings.key,
        set: { value: parsed.data, updatedBy },
      });
    // Rights defaults are large; record only that they changed.
    const summary =
      key === "rights.defaults" ? {} : { from: previous?.value ?? null, to: parsed.data };
    await audit(tx, {
      action: "settings.changed",
      entityType: "app_setting",
      data: { key, ...summary },
    });
    return { key, value: parsed.data };
  });
}
