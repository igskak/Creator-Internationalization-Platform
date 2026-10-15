import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import type { ServiceContext } from "../../core";

// What every dashboard query takes: a market (or all of them) and a time window.

export const DEFAULT_MIN_SAMPLE = 3;
const MAX_WINDOW_DAYS = 400;
const DAY_MS = 86_400_000;

export const DateRangeInput = z.object({
  /** Inclusive, ISO 8601. */
  from: z.iso.datetime({ offset: true }),
  /** Exclusive, ISO 8601. */
  to: z.iso.datetime({ offset: true }),
  marketId: z.uuid().optional(),
});
export type DateRangeInput = z.input<typeof DateRangeInput>;

export type Range = { from: Date; to: Date; marketId: string | undefined };

/** The window as dates; refuses an empty or absurdly long one. */
export function parseRange(raw: DateRangeInput): Range {
  const input = DateRangeInput.parse(raw);
  const from = new Date(input.from);
  const to = new Date(input.to);
  if (!(from.getTime() < to.getTime())) {
    throw new ValidationError("The window must end after it starts.", {
      fieldErrors: { to: ["Pick an end after the start."] },
    });
  }
  if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * DAY_MS) {
    throw new ValidationError(`The window is longer than ${MAX_WINDOW_DAYS} days.`, {
      fieldErrors: { to: [`At most ${MAX_WINDOW_DAYS} days.`] },
    });
  }
  return { from, to, marketId: input.marketId };
}

/** `YYYY-MM-DD` (UTC) of an instant: the day columns of `account_metric_snapshots`. */
export const dayOf = (instant: Date): string => instant.toISOString().slice(0, 10);

/** Groups with fewer posts than this are "low sample" (`analytics.min_sample`, default 3). */
export async function getMinSample(ctx: ServiceContext, override?: number): Promise<number> {
  if (override !== undefined) return override;
  const [row] = await ctx.db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, "analytics.min_sample"));
  return typeof row?.value === "number" && row.value >= 1 ? row.value : DEFAULT_MIN_SAMPLE;
}

/** A numeric column as a number; null stays null (a rate with no reach is not 0). */
export const num = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
