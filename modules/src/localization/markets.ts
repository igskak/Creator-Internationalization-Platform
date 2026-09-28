import { schema } from "@rc/db";
import { asc, eq } from "@rc/db/orm";
import type { ServiceContext } from "../core";

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
