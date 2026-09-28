import { schema } from "@rc/db";
import { ForbiddenPatternList, VisualHypothesisList, VocabularyList } from "@rc/db/json";
import { asc, eq } from "@rc/db/orm";
import { ForbiddenError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import { audit, type ServiceContext, withTransaction } from "../core";

export type MarketSummary = {
  id: string;
  code: string;
  displayName: string;
  flagEmoji: string | null;
  isActive: boolean;
};

const summary = {
  id: schema.markets.id,
  code: schema.markets.code,
  displayName: schema.markets.displayName,
  flagEmoji: schema.markets.flagEmoji,
  isActive: schema.markets.isActive,
};

/** All markets in sidebar order; inactive ones (e.g. fr-FR) are included and shown disabled. */
export function listMarkets(ctx: ServiceContext): Promise<MarketSummary[]> {
  return ctx.db
    .select(summary)
    .from(schema.markets)
    .orderBy(asc(schema.markets.sortOrder), asc(schema.markets.code));
}

export async function getMarketByCode(
  ctx: ServiceContext,
  code: string,
): Promise<MarketSummary | null> {
  const [market] = await ctx.db
    .select(summary)
    .from(schema.markets)
    .where(eq(schema.markets.code, code));
  return market ?? null;
}

export type MarketProfile = typeof schema.markets.$inferSelect;

export async function getMarketProfile(
  ctx: ServiceContext,
  code: string,
): Promise<MarketProfile | null> {
  const [market] = await ctx.db.select().from(schema.markets).where(eq(schema.markets.code, code));
  return market ?? null;
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const UpdateMarketInput = z.object({
  marketId: z.uuid(),
  displayName: z.string().trim().min(1).max(60).optional(),
  toneNotes: z.string().max(20_000).optional(),
  foodCultureNotes: z.string().max(20_000).optional(),
  preferredVocabulary: VocabularyList.optional(),
  /** REGEX patterns must compile (ForbiddenPattern). */
  forbiddenPatterns: ForbiddenPatternList.optional(),
  visualHypotheses: VisualHypothesisList.optional(),
  timezone: z.string().refine(isTimeZone, "Unknown IANA time zone, e.g. Europe/Madrid").optional(),
  measurementSystem: z.enum(["METRIC", "IMPERIAL", "DUAL"]).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateMarketInput = z.input<typeof UpdateMarketInput>;

/**
 * 05 §5.2 updateMarket (owner, editor). Only owners may change `isActive`. Audit `market.updated`
 * with the changed field names.
 */
export async function updateMarket(
  ctx: ServiceContext,
  raw: UpdateMarketInput,
): Promise<MarketProfile> {
  const parsed = UpdateMarketInput.safeParse(raw);
  if (!parsed.success)
    throw ValidationError.fromZod(parsed.error, "Some market fields are invalid.");
  const { marketId, ...changes } = parsed.data;
  if (
    changes.isActive !== undefined &&
    !(ctx.actor.type === "USER" && ctx.actor.role === "owner")
  ) {
    throw new ForbiddenError("Only owners can activate or deactivate a market.");
  }

  return withTransaction(ctx, async (tx) => {
    const [current] = await tx.db
      .select()
      .from(schema.markets)
      .where(eq(schema.markets.id, marketId));
    if (!current) throw new NotFoundError("Market not found.", { details: { marketId } });
    const changed = Object.entries(changes)
      .filter(
        ([field, value]) =>
          value !== undefined &&
          JSON.stringify(value) !== JSON.stringify(current[field as keyof MarketProfile]),
      )
      .map(([field]) => field);
    if (changed.length === 0) return current;

    const [market] = await tx.db
      .update(schema.markets)
      .set(
        Object.fromEntries(changed.map((field) => [field, changes[field as keyof typeof changes]])),
      )
      .where(eq(schema.markets.id, marketId))
      .returning();
    if (!market) throw new NotFoundError("Market not found.", { details: { marketId } });
    await audit(tx, {
      action: "market.updated",
      entityType: "market",
      entityId: market.id,
      marketId: market.id,
      data: { fields: changed },
    });
    return market;
  });
}
