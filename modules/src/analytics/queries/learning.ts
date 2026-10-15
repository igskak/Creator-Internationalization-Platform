import { schema } from "@rc/db";
import { and, asc, desc, eq, gte, isNotNull, lt, type SQL, sql } from "@rc/db/orm";
import { ValidationError } from "@rc/lib/errors";
import { PRESIGN_TTL } from "@rc/lib/providers/storage";
import { z } from "zod";
import type { ServiceContext } from "../../core";
import { getMinSample, num, parseRange } from "./range";

// Content learning (11 §11.4, S§12.2): which value of a dimension goes with better D7 results, in
// one market. The dimension is one of a fixed list: its SQL is chosen here, never taken from the
// request. A group with fewer posts than `analytics.min_sample` is shown but marked low sample.

const d = schema.vPublicationDimensions;
const m = schema.vPublicationMetricsD7;

export const LEARNING_DIMENSIONS = [
  "category",
  "angle",
  "hook_type",
  "format",
  "visual_style",
  "cta_type",
  "offer",
  "daypart",
  "weekday",
  "slide_count",
  "caption_length",
  "first_template",
  "template_sequence",
  "generation_version",
] as const;
export type LearningDimension = (typeof LEARNING_DIMENSIONS)[number];

/** The SQL of each dimension: a text value per post, null when the post has none. */
const EXPRESSIONS: Record<LearningDimension, SQL> = {
  category: sql`${d.category}`,
  angle: sql`${d.angle}`,
  hook_type: sql`${d.hookType}`,
  format: sql`${d.format}`,
  visual_style: sql`${d.visualStyle}`,
  cta_type: sql`${d.ctaType}`,
  offer: sql`${d.offerId}::text`,
  daypart: sql`${d.daypartLocal}`,
  // ISO weekday as 1 (Monday) … 7 (Sunday).
  weekday: sql`${d.weekdayLocal}::text`,
  slide_count: sql`case when ${d.slideCount} is null then null when ${d.slideCount} <= 5 then '1-5' when ${d.slideCount} <= 7 then '6-7' else '8+' end`,
  caption_length: sql`case when ${d.captionChars} is null then null when ${d.captionChars} <= 300 then '0-300' when ${d.captionChars} <= 600 then '301-600' when ${d.captionChars} <= 1000 then '601-1000' else '1001+' end`,
  first_template: sql`${d.firstTemplateId}`,
  template_sequence: sql`array_to_string(${d.templateSequence}, '>')`,
  generation_version: sql`${d.generationVersion}`,
};

/** The value shown for posts that have none of the dimension. */
export const NO_VALUE = "NONE";

export const ContentLearningInput = z.object({
  marketId: z.uuid(),
  dimension: z.enum(LEARNING_DIMENSIONS),
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  /** Overrides `analytics.min_sample`. */
  minSample: z.number().int().min(1).max(1000).optional(),
});

export type LearningRow = {
  value: string;
  /** Posts of the group with D7 numbers. */
  n: number;
  medianSaveRate: number | null;
  medianShareRate: number | null;
  medianReach: number | null;
  /** Median save rate of the group / that of the market; null when either is missing or 0. */
  liftVsMarket: number | null;
  lowSample: boolean;
};

export type ContentLearning = {
  dimension: LearningDimension;
  minSample: number;
  /** All posts of the market in the window that have D7 numbers. */
  market: {
    n: number;
    medianSaveRate: number | null;
    medianShareRate: number | null;
    medianReach: number | null;
  };
  /** Best median save rate first; groups without one last. */
  rows: LearningRow[];
};

const medians = {
  n: sql<number>`count(*)::int`,
  save: sql<string | null>`percentile_cont(0.5) within group (order by ${m.saveRate})`,
  share: sql<string | null>`percentile_cont(0.5) within group (order by ${m.shareRate})`,
  reach: sql<string | null>`percentile_cont(0.5) within group (order by ${m.reach})`,
};

export async function getContentLearning(
  ctx: ServiceContext,
  raw: z.input<typeof ContentLearningInput>,
): Promise<ContentLearning> {
  const parsed = ContentLearningInput.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const input = parsed.data;
  const range = parseRange({ from: input.from, to: input.to, marketId: input.marketId });
  const minSample = await getMinSample(ctx, input.minSample);
  const where = and(
    eq(d.marketId, input.marketId),
    gte(d.publishedAt, range.from),
    lt(d.publishedAt, range.to),
  );

  const [whole] = await ctx.db
    .select(medians)
    .from(d)
    .innerJoin(m, eq(m.publicationId, d.publicationId))
    .where(where);
  const marketSave = num(whole?.save);

  // The fallback is a literal, not a parameter: the select list and the GROUP BY must be the same text.
  const value = sql<string>`coalesce((${EXPRESSIONS[input.dimension]})::text, ${sql.raw(`'${NO_VALUE}'`)})`;
  const groups = await ctx.db
    .select({ value, ...medians })
    .from(d)
    .innerJoin(m, eq(m.publicationId, d.publicationId))
    .where(where)
    .groupBy(value)
    .orderBy(
      sql`percentile_cont(0.5) within group (order by ${m.saveRate}) desc nulls last`,
      asc(value),
    );

  return {
    dimension: input.dimension,
    minSample,
    market: {
      n: Number(whole?.n ?? 0),
      medianSaveRate: marketSave,
      medianShareRate: num(whole?.share),
      medianReach: num(whole?.reach),
    },
    rows: groups.map((g) => {
      const save = num(g.save);
      return {
        value: g.value,
        n: Number(g.n),
        medianSaveRate: save,
        medianShareRate: num(g.share),
        medianReach: num(g.reach),
        liftVsMarket:
          save !== null && marketSave !== null && marketSave > 0 ? save / marketSave : null,
        lowSample: Number(g.n) < minSample,
      };
    }),
  };
}

// --- Top and bottom posts ------------------------------------------------------------------------

export const RankedPostsInput = z.object({
  marketId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  metric: z.enum(["save_rate", "share_rate", "reach"]).default("save_rate"),
  limit: z.number().int().min(1).max(20).default(5),
});

export type RankedPost = {
  publicationId: string;
  ideaId: string;
  marketCode: string;
  format: string;
  hook: string | null;
  hookType: string | null;
  publishedAt: Date;
  permalink: string | null;
  value: number;
  reach: number | null;
  /** A presigned link to the first picture of a carousel; null for a Reel. */
  thumbnailUrl: string | null;
};

/**
 * The best and the worst posts of a window by one metric at D7. Posts without the metric are left
 * out, and a post is never in both lists: with few posts the worst list is what is left over.
 */
export async function getRankedPosts(
  ctx: ServiceContext,
  raw: z.input<typeof RankedPostsInput>,
): Promise<{ top: RankedPost[]; bottom: RankedPost[]; considered: number }> {
  const parsed = RankedPostsInput.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const input = parsed.data;
  const range = parseRange({
    from: input.from,
    to: input.to,
    ...(input.marketId ? { marketId: input.marketId } : {}),
  });
  const column = { save_rate: m.saveRate, share_rate: m.shareRate, reach: m.reach }[input.metric];
  const rows = await ctx.db
    .select({
      publicationId: d.publicationId,
      ideaId: d.masterIdeaId,
      marketCode: d.marketCode,
      format: d.format,
      hook: schema.contentVariants.hook,
      hookType: d.hookType,
      publishedAt: d.publishedAt,
      permalink: schema.publications.permalink,
      value: column,
      reach: m.reach,
      thumbnailKey: sql<
        string | null
      >`${schema.contentVariantVersions.snapshot} -> 'renderedSlideKeys' ->> 0`,
    })
    .from(d)
    .innerJoin(m, eq(m.publicationId, d.publicationId))
    .innerJoin(schema.contentVariants, eq(schema.contentVariants.id, d.variantId))
    .innerJoin(schema.publications, eq(schema.publications.id, d.publicationId))
    .innerJoin(
      schema.contentVariantVersions,
      eq(schema.contentVariantVersions.id, schema.publications.contentVariantVersionId),
    )
    .where(
      and(
        gte(d.publishedAt, range.from),
        lt(d.publishedAt, range.to),
        isNotNull(column),
        ...(range.marketId ? [eq(d.marketId, range.marketId)] : []),
      ),
    )
    .orderBy(desc(column), desc(d.publishedAt));

  const thumb = async (key: string | null) => {
    if (!key) return null;
    try {
      return (await ctx.storage.presignGet(key, { expiresInSeconds: PRESIGN_TTL.preview })).url;
    } catch {
      return null;
    }
  };
  const make = async (r: (typeof rows)[number]): Promise<RankedPost> => ({
    publicationId: r.publicationId,
    ideaId: r.ideaId,
    marketCode: r.marketCode,
    format: r.format,
    hook: r.hook,
    hookType: r.hookType,
    publishedAt: r.publishedAt,
    permalink: r.permalink,
    value: num(r.value) ?? 0,
    reach: r.reach,
    thumbnailUrl: await thumb(r.thumbnailKey),
  });
  const top = rows.slice(0, input.limit);
  const rest = rows.slice(input.limit);
  const bottom = rest.slice(-input.limit).reverse();
  return {
    top: await Promise.all(top.map(make)),
    bottom: await Promise.all(bottom.map(make)),
    considered: rows.length,
  };
}
