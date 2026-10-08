import { schema } from "@rc/db";
import type {
  CriticReport,
  CtaSpec,
  DifferentiationReport,
  GenerationConfig,
  MarketBrief,
  Slide,
} from "@rc/db/json";
import { asc, eq, sql } from "@rc/db/orm";
import { registry } from "@rc/templates";
import type { ServiceContext } from "../../core";
import { getIdeaDetail, type IdeaDetail } from "../ideas";

// What the review screen reads (plan 05 §5.7 `getReviewBundle`, 10 §10.3; read-only in M2-15):
// the idea with the approved text of its cards, and every market's variant with its critic report,
// flags and comparison with the others. Editing and approving come with M4.

export type VariantView = {
  id: string;
  marketCode: string;
  marketName: string;
  flagEmoji: string | null;
  status: (typeof schema.contentVariants.$inferSelect)["status"];
  /** 1–5, null while there is no review. */
  qualityScore: number | null;
  flags: string[];
  hook: string | null;
  hookType: string | null;
  caption: string | null;
  cta: CtaSpec | null;
  hashtags: string[];
  slides: Slide[];
  brief: MarketBrief | null;
  critic: CriticReport | null;
  differentiation: DifferentiationReport | null;
  offer: { name: string; type: string } | null;
  generationVersion: string | null;
  generationConfig: GenerationConfig | null;
  lastError: { code: string; message: string } | null;
  /** Generated content exists (a failed or queued variant has none yet). */
  hasContent: boolean;
  lockVersion: number;
  updatedAt: Date;
};

export type ReviewBundle = {
  idea: IdeaDetail;
  variants: VariantView[];
  /** Model cost of the idea's pipeline runs; null when no run is priced. */
  costUsd: number | null;
};

/** Slots in the order of the template (jsonb does not keep the order of keys). */
function inTemplateOrder(slide: Slide): Slide {
  const order = Object.keys(registry.get(slide.templateId)?.textSlots ?? {});
  const known = order.filter((name) => name in slide.slots);
  const rest = Object.keys(slide.slots).filter((name) => !order.includes(name));
  return {
    ...slide,
    slots: Object.fromEntries(
      [...known, ...rest].map((name) => [name, slide.slots[name] as string]),
    ),
  };
}

export async function getReviewBundle(
  ctx: ServiceContext,
  masterIdeaId: string,
): Promise<ReviewBundle> {
  const idea = await getIdeaDetail(ctx, masterIdeaId);
  const rows = await ctx.db
    .select({
      v: schema.contentVariants,
      marketCode: schema.markets.code,
      marketName: schema.markets.displayName,
      flagEmoji: schema.markets.flagEmoji,
      offerName: schema.offers.name,
      offerType: schema.offers.type,
    })
    .from(schema.contentVariants)
    .innerJoin(schema.markets, eq(schema.markets.id, schema.contentVariants.marketId))
    .leftJoin(schema.offers, eq(schema.offers.id, schema.contentVariants.offerId))
    .where(eq(schema.contentVariants.masterIdeaId, masterIdeaId))
    .orderBy(asc(schema.markets.sortOrder), asc(schema.markets.code));

  const [cost] = await ctx.db
    .select({
      total: sql<string | null>`sum(${schema.generationRuns.costUsd})`,
      runs: sql<number>`count(*)::int`,
    })
    .from(schema.generationRuns)
    .where(eq(schema.generationRuns.masterIdeaId, masterIdeaId));

  return {
    idea,
    variants: rows
      .filter((r) => r.v.status !== "REJECTED")
      .map(({ v, marketCode, marketName, flagEmoji, offerName, offerType }) => ({
        id: v.id,
        marketCode,
        marketName,
        flagEmoji,
        status: v.status,
        qualityScore: v.qualityScore === null ? null : Number(v.qualityScore),
        flags: v.flags,
        hook: v.hook,
        hookType: v.hookType,
        caption: v.caption,
        cta: v.ctaJson,
        hashtags: v.hashtags,
        slides: v.slidesJson.map(inTemplateOrder),
        brief: v.marketBriefJson,
        critic: v.criticReport,
        differentiation: v.differentiationReport,
        offer: offerName && offerType ? { name: offerName, type: offerType } : null,
        generationVersion: v.generationVersion,
        generationConfig: v.generationConfig,
        lastError: v.lastError ? { code: v.lastError.code, message: v.lastError.message } : null,
        hasContent: v.slidesJson.length > 0,
        lockVersion: v.lockVersion,
        updatedAt: v.updatedAt,
      })),
    costUsd: cost?.total == null ? null : Number(cost.total),
  };
}
