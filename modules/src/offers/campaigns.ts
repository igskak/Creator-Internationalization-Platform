import { randomInt } from "node:crypto";
import { schema } from "@rc/db";
import type { UtmSpec } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import type { ServiceContext } from "../core";
import { buildUtm } from "./utm";

// Campaign ids of the commercial posts (plan 11 §11.7, M4-11): `rc-{market}-{yymmdd}-{6 chars}`,
// e.g. `rc-es-261011-k3f9qa`, made when a commercial variant is approved, stored in
// `content_variants.campaign_id` (unique) and in the approved snapshot. It is also the name of the
// ManyChat flow, so a sale can be traced to the post.

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SUFFIX_LENGTH = 6;
const ATTEMPTS = 8;

/** `es-ES` → `es`, `en` → `en`: the language part of the market code, lower case. */
export const campaignMarket = (marketCode: string): string =>
  (marketCode.split("-")[0] ?? marketCode).toLowerCase().replace(/[^a-z0-9]/g, "");

/** `yymmdd` of a UTC date. */
export const campaignDate = (date: Date): string =>
  `${String(date.getUTCFullYear()).slice(-2)}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;

export function createCampaignId(
  marketCode: string,
  date: Date,
  random: (max: number) => number = randomInt,
): string {
  const suffix = Array.from(
    { length: SUFFIX_LENGTH },
    () => ALPHABET[random(ALPHABET.length)] ?? "x",
  ).join("");
  return `rc-${campaignMarket(marketCode)}-${campaignDate(date)}-${suffix}`;
}

export const CAMPAIGN_ID = /^rc-[a-z0-9]{1,8}-\d{6}-[a-z0-9]{6}$/;

export type Campaign = { campaignId: string; utm: UtmSpec };

/**
 * The campaign of a commercial variant: its existing id (an approval that is done again keeps it,
 * so the links already in use stay valid) or a new one that no variant has, and the UTM tags with
 * the landing URL of the variant's offer. Nothing is written; the approval stores both.
 */
export async function planCampaign(
  ctx: ServiceContext,
  variant: { id: string; marketId: string; offerId: string | null; campaignId: string | null },
  random: (max: number) => number = randomInt,
): Promise<Campaign> {
  const [offer] = variant.offerId
    ? await ctx.db
        .select({ landingUrl: schema.offers.landingUrl })
        .from(schema.offers)
        .where(eq(schema.offers.id, variant.offerId))
    : [];
  let campaignId = variant.campaignId;
  if (!campaignId) {
    const [market] = await ctx.db
      .select({ code: schema.markets.code })
      .from(schema.markets)
      .where(eq(schema.markets.id, variant.marketId));
    for (let attempt = 0; attempt < ATTEMPTS && !campaignId; attempt++) {
      const candidate = createCampaignId(market?.code ?? "xx", ctx.clock.now(), random);
      const [taken] = await ctx.db
        .select({ id: schema.contentVariants.id })
        .from(schema.contentVariants)
        .where(eq(schema.contentVariants.campaignId, candidate));
      if (!taken) campaignId = candidate;
    }
    if (!campaignId) throw new Error("Could not find a free campaign id.");
  }
  return {
    campaignId,
    utm: buildUtm({ campaignId, variantId: variant.id, landingUrl: offer?.landingUrl }),
  };
}
