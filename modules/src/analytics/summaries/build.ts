import { schema } from "@rc/db";
import type { PerformanceMemory, PerformancePattern, PerformanceStats } from "@rc/db/json";
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, sql } from "@rc/db/orm";
import { ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import { findCoverageGaps, findOverusedThemes } from "../../content/ideas/overuse";
import type { ServiceContext } from "../../core";
import { getMinSample } from "../queries/range";

// Performance memory v1 (plan 11 §11.5, M7-02): a deterministic summary of what did better and
// worse at D7, what is overused, what is missing, what was never tried, which offers matter and
// what reviewers keep changing. SQL and code only, no model. One summary per market, and one across
// markets (`ALL`, for the idea stage, whose ideas are market-neutral): there every post's rate is
// divided by its own market's median first, so a bigger market does not drown out a smaller one.

const DAY_MS = 86_400_000;
export const SUMMARY_WINDOWS = [28, 56, 90] as const;
export const DEFAULT_SUMMARY_WINDOW = 56;
/** Below this many posts with D7 numbers the pattern lists stay empty (11 §11.5). */
export const DEFAULT_MIN_POSTS_FOR_PATTERNS = 20;
const TOP_LIFT = 1.2;
const WEAK_LIFT = 0.8;
const MAX_PATTERNS = 5;
const MAX_LIST = 5;
/** About 1,500 tokens of JSON. */
export const MAX_SUMMARY_CHARS = 6000;

/** The dimensions a pattern can be about (a subset of the learning dimensions). */
export const SUMMARY_DIMENSIONS = [
  "category",
  "angle",
  "hook_type",
  "visual_style",
  "cta_type",
  "first_template",
  "daypart",
  "slide_count",
  "generation_version",
] as const;
type Dimension = (typeof SUMMARY_DIMENSIONS)[number];

export const BuildSummaryInput = z.object({
  /** A market, or null for the summary across markets. */
  marketId: z.uuid().nullable(),
  windowDays: z
    .union([z.literal(28), z.literal(56), z.literal(90)])
    .default(DEFAULT_SUMMARY_WINDOW),
  /** Overrides the setting `learning.min_posts_for_patterns`. */
  minPostsForPatterns: z.number().int().min(1).max(1000).optional(),
});

export type BuiltSummary = {
  summaryId: string;
  marketId: string | null;
  memory: PerformanceMemory;
  stats: PerformanceStats;
};

type PostRow = {
  marketId: string;
  values: Record<Dimension, string | null>;
  saveRate: number | null;
  shareRate: number | null;
  isExactD7: boolean;
};

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};
const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const confidence = (n: number): PerformancePattern["confidence"] =>
  n < 5 ? "low" : n < 10 ? "medium" : "high";
const slideBucket = (n: number | null) =>
  n === null ? null : n <= 5 ? "1-5" : n <= 7 ? "6-7" : "8+";

async function settingNumber(ctx: ServiceContext, key: string): Promise<number | null> {
  const [row] = await ctx.db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, key));
  return typeof row?.value === "number" ? row.value : null;
}

/** Posts of the window with D7 numbers, with their dimension values. */
async function loadPosts(ctx: ServiceContext, marketId: string | null, from: Date, to: Date) {
  const d = schema.vPublicationDimensions;
  const m = schema.vPublicationMetricsD7;
  const rows = await ctx.db
    .select({
      marketId: d.marketId,
      category: d.category,
      angle: d.angle,
      hookType: d.hookType,
      visualStyle: d.visualStyle,
      ctaType: d.ctaType,
      firstTemplate: d.firstTemplateId,
      daypart: d.daypartLocal,
      slideCount: d.slideCount,
      generationVersion: d.generationVersion,
      saveRate: m.saveRate,
      shareRate: m.shareRate,
      isExactD7: m.isExactD7,
    })
    .from(d)
    .innerJoin(m, eq(m.publicationId, d.publicationId))
    .where(
      and(
        gte(d.publishedAt, from),
        lt(d.publishedAt, to),
        ...(marketId ? [eq(d.marketId, marketId)] : []),
      ),
    );
  return rows.map(
    (r): PostRow => ({
      marketId: r.marketId,
      values: {
        category: r.category,
        angle: r.angle,
        hook_type: r.hookType,
        visual_style: r.visualStyle,
        cta_type: r.ctaType,
        first_template: r.firstTemplate,
        daypart: r.daypart,
        slide_count: slideBucket(r.slideCount),
        generation_version: r.generationVersion,
      },
      saveRate: r.saveRate === null ? null : Number(r.saveRate),
      shareRate: r.shareRate === null ? null : Number(r.shareRate),
      isExactD7: r.isExactD7,
    }),
  );
}

/**
 * Patterns: for each dimension value with at least `minSample` posts, the median of the posts'
 * rates relative to their market's median (1 = like the market). Top: lift ≥ 1.2, weak: ≤ 0.8,
 * five of each at most, the strongest first.
 */
export function findPatterns(
  posts: readonly PostRow[],
  minSample: number,
): { top: PerformancePattern[]; weak: PerformancePattern[]; stats: PerformanceStats } {
  const marketMedians: PerformanceStats["marketMedians"] = {};
  const byMarket = new Map<string, PostRow[]>();
  for (const p of posts) byMarket.set(p.marketId, [...(byMarket.get(p.marketId) ?? []), p]);
  for (const [marketId, rows] of byMarket) {
    marketMedians[marketId] = {
      saveRate: median(rows.flatMap((r) => (r.saveRate === null ? [] : [r.saveRate]))),
      shareRate: median(rows.flatMap((r) => (r.shareRate === null ? [] : [r.shareRate]))),
      n: rows.length,
    };
  }
  const relative = (p: PostRow, metric: "saveRate" | "shareRate") => {
    const base = marketMedians[p.marketId]?.[metric];
    const value = p[metric];
    return value === null || !base ? null : value / base;
  };

  const groups: PerformanceStats["groups"] = [];
  const candidates: PerformancePattern[] = [];
  for (const dimension of SUMMARY_DIMENSIONS) {
    const byValue = new Map<string, PostRow[]>();
    for (const p of posts) {
      const value = p.values[dimension];
      if (value === null || value === "") continue;
      byValue.set(value, [...(byValue.get(value) ?? []), p]);
    }
    // A dimension with one value says nothing.
    if (byValue.size < 2) continue;
    for (const [value, rows] of byValue) {
      const save = median(rows.flatMap((r) => relative(r, "saveRate") ?? []));
      const share = median(rows.flatMap((r) => relative(r, "shareRate") ?? []));
      groups.push({
        dimension,
        value,
        n: rows.length,
        saveLift: save === null ? null : round(save),
        shareLift: share === null ? null : round(share),
      });
      if (rows.length < minSample) continue;
      for (const [metric, lift] of [
        ["save_rate", save],
        ["share_rate", share],
      ] as const) {
        if (lift === null) continue;
        candidates.push({
          dimension,
          value,
          n: rows.length,
          metric,
          lift: round(lift),
          confidence: confidence(rows.length),
        });
      }
    }
  }
  const byStrength = (a: PerformancePattern, b: PerformancePattern) =>
    b.n - a.n || a.dimension.localeCompare(b.dimension) || a.value.localeCompare(b.value);
  return {
    top: candidates
      .filter((c) => c.lift >= TOP_LIFT)
      .sort((a, b) => b.lift - a.lift || byStrength(a, b))
      .slice(0, MAX_PATTERNS),
    weak: candidates
      .filter((c) => c.lift <= WEAK_LIFT)
      .sort((a, b) => a.lift - b.lift || byStrength(a, b))
      .slice(0, MAX_PATTERNS),
    stats: { marketMedians, groups },
  };
}

/** `slides.s3.slots.title` → `slides.slots.title`: one name per kind of field. */
export const fieldKind = (path: string): string =>
  path.startsWith("slides.") ? path.replace(/^slides\.[^.]+/u, "slides") : path;

async function loadFeedback(
  ctx: ServiceContext,
  marketId: string | null,
  from: Date,
  to: Date,
): Promise<PerformanceMemory["feedback"]> {
  const e = schema.reviewEvents;
  const v = schema.contentVariants;
  const scope = and(
    gte(e.createdAt, from),
    lt(e.createdAt, to),
    ...(marketId ? [eq(v.marketId, marketId)] : []),
  );
  const reasons = await ctx.db
    .select({ code: e.reasonCode, n: sql<number>`count(*)::int` })
    .from(e)
    .innerJoin(v, eq(v.id, e.contentVariantId))
    .where(and(scope, inArray(e.action, ["REJECT", "REQUEST_CHANGES"]), isNotNull(e.reasonCode)))
    .groupBy(e.reasonCode)
    .orderBy(sql`count(*) desc`, asc(e.reasonCode))
    .limit(MAX_LIST);
  const edits = await ctx.db
    .select({ field: e.field })
    .from(e)
    .innerJoin(v, eq(v.id, e.contentVariantId))
    .where(and(scope, eq(e.action, "EDIT"), isNotNull(e.field)));
  const fields = new Map<string, number>();
  for (const r of edits) {
    const kind = fieldKind(r.field ?? "");
    fields.set(kind, (fields.get(kind) ?? 0) + 1);
  }
  const hooks = await ctx.db
    .select({ original: e.originalValue, edited: e.editedValue })
    .from(e)
    .innerJoin(v, eq(v.id, e.contentVariantId))
    .where(and(scope, eq(e.action, "EDIT"), eq(e.field, "hook")))
    .orderBy(desc(e.createdAt))
    .limit(MAX_LIST);
  const clip = (s: string) => (s.length > 140 ? `${s.slice(0, 139)}…` : s);
  return {
    topRejectionReasons: reasons.map((r) => ({ code: r.code ?? "", count: Number(r.n) })),
    mostEditedFields: [...fields.entries()]
      .map(([field, count]) => ({ field, count }))
      .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field))
      .slice(0, MAX_LIST),
    hookRewrites: hooks.flatMap((h) =>
      typeof h.original === "string" && typeof h.edited === "string" && h.original !== h.edited
        ? [{ original: clip(h.original), edited: clip(h.edited) }]
        : [],
    ),
  };
}

async function loadUntested(
  ctx: ServiceContext,
  marketId: string | null,
  from: Date,
  to: Date,
): Promise<PerformanceMemory["untestedHypotheses"]> {
  const markets = await ctx.db
    .select({
      id: schema.markets.id,
      code: schema.markets.code,
      hypotheses: schema.markets.visualHypotheses,
    })
    .from(schema.markets)
    .where(marketId ? eq(schema.markets.id, marketId) : eq(schema.markets.isActive, true));
  const untested: PerformanceMemory["untestedHypotheses"] = [];
  for (const m of markets) {
    for (const h of m.hypotheses ?? []) {
      if (h.status === "UNTESTED") {
        untested.push({
          source: "visual_hypothesis",
          description: `${marketId ? "" : `${m.code}: `}${h.description} (visual style ${h.visualStyle})`,
        });
      }
    }
  }
  const drafts = await ctx.db
    .select({ name: schema.experiments.name, hypothesis: schema.experiments.hypothesis })
    .from(schema.experiments)
    .where(
      and(
        eq(schema.experiments.status, "DRAFT"),
        ...(marketId ? [eq(schema.experiments.marketId, marketId)] : []),
      ),
    )
    .orderBy(desc(schema.experiments.createdAt))
    .limit(MAX_LIST);
  for (const x of drafts) {
    untested.push({ source: "experiment", description: `${x.name}: ${x.hypothesis}` });
  }
  const hookTypes = await ctx.db
    .select({ code: schema.taxonomyTerms.code })
    .from(schema.taxonomyTerms)
    .where(and(eq(schema.taxonomyTerms.kind, "hook_type"), eq(schema.taxonomyTerms.isActive, true)))
    .orderBy(asc(schema.taxonomyTerms.sortOrder), asc(schema.taxonomyTerms.code));
  const d = schema.vPublicationDimensions;
  const used = await ctx.db
    .selectDistinct({ hookType: d.hookType })
    .from(d)
    .where(
      and(
        gte(d.publishedAt, from),
        lt(d.publishedAt, to),
        ...(marketId ? [eq(d.marketId, marketId)] : []),
      ),
    );
  const usedSet = new Set(used.map((u) => u.hookType));
  for (const h of hookTypes.filter((h) => !usedSet.has(h.code)).slice(0, MAX_LIST)) {
    untested.push({
      source: "hook_type",
      description: `Hook type ${h.code} has no post in the window.`,
    });
  }
  return untested;
}

async function loadOffers(
  ctx: ServiceContext,
  marketId: string | null,
  from: Date,
  to: Date,
): Promise<PerformanceMemory["offerPriorities"]> {
  const offers = await ctx.db
    .select({
      offerId: schema.offers.id,
      productCode: schema.products.code,
      priority: schema.offers.priority,
    })
    .from(schema.offers)
    .innerJoin(schema.products, eq(schema.products.id, schema.offers.productId))
    .innerJoin(schema.markets, eq(schema.markets.id, schema.offers.marketId))
    .where(
      and(
        eq(schema.offers.status, "ACTIVE"),
        eq(schema.products.status, "ACTIVE"),
        marketId ? eq(schema.offers.marketId, marketId) : eq(schema.markets.isActive, true),
      ),
    )
    .orderBy(desc(schema.offers.priority), asc(schema.products.code))
    .limit(MAX_LIST);
  if (offers.length === 0) return [];
  const a = schema.attributionEvents;
  const results = await ctx.db
    .select({
      offerId: a.offerId,
      leads: sql<number>`coalesce(sum(${a.quantity}) filter (where ${a.type} = 'LEAD'), 0)::int`,
      sales: sql<number>`coalesce(sum(${a.quantity}) filter (where ${a.type} = 'SALE'), 0)::int`,
    })
    .from(a)
    .where(
      and(
        inArray(
          a.offerId,
          offers.map((o) => o.offerId),
        ),
        gte(a.occurredAt, from),
        lt(a.occurredAt, to),
      ),
    )
    .groupBy(a.offerId);
  const byOffer = new Map(results.map((r) => [r.offerId, r]));
  return offers.map((o) => {
    const r = byOffer.get(o.offerId);
    return {
      offerId: o.offerId,
      productCode: o.productCode,
      priority: o.priority,
      ...(r ? { leads: Number(r.leads), sales: Number(r.sales) } : {}),
    };
  });
}

/** Shortens the lists until the JSON is under {@link MAX_SUMMARY_CHARS}; the caveat says so. */
export function fitSummary(memory: PerformanceMemory): PerformanceMemory {
  const size = (m: PerformanceMemory) => JSON.stringify(m).length;
  if (size(memory) <= MAX_SUMMARY_CHARS) return memory;
  const m: PerformanceMemory = structuredClone(memory);
  const shorten: (() => boolean)[] = [
    () => m.feedback.hookRewrites.length > 2 && Boolean(m.feedback.hookRewrites.pop()),
    () => m.untestedHypotheses.length > 3 && Boolean(m.untestedHypotheses.pop()),
    () => m.overusedThemes.length > 3 && Boolean(m.overusedThemes.pop()),
    () => m.coverageGaps.length > 3 && Boolean(m.coverageGaps.pop()),
    () => m.feedback.hookRewrites.length > 0 && Boolean(m.feedback.hookRewrites.pop()),
    () => m.weakPatterns.length > 3 && Boolean(m.weakPatterns.pop()),
    () => m.topPatterns.length > 3 && Boolean(m.topPatterns.pop()),
    () => m.untestedHypotheses.length > 0 && Boolean(m.untestedHypotheses.pop()),
  ];
  for (const step of shorten) {
    while (size(m) > MAX_SUMMARY_CHARS && step()) {
      // keep shortening this list
    }
  }
  m.caveats.push("Some lists were shortened to keep the summary short.");
  return m;
}

/**
 * Builds and stores the summary of one market (or across markets) over the window ending today.
 * Nothing is sent anywhere: the idea stage and the writer read the newest row.
 */
export async function buildPerformanceSummary(
  ctx: ServiceContext,
  raw: z.input<typeof BuildSummaryInput>,
): Promise<BuiltSummary> {
  const parsed = BuildSummaryInput.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const input = parsed.data;
  const now = ctx.clock.now();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const from = new Date(to.getTime() - input.windowDays * DAY_MS);
  let marketCode = "ALL";
  if (input.marketId) {
    const [market] = await ctx.db
      .select({ code: schema.markets.code })
      .from(schema.markets)
      .where(eq(schema.markets.id, input.marketId));
    if (!market) throw new ValidationError("Unknown market.");
    marketCode = market.code;
  }
  const minSample = await getMinSample(ctx);
  const minPosts =
    input.minPostsForPatterns ??
    (await settingNumber(ctx, "learning.min_posts_for_patterns")) ??
    DEFAULT_MIN_POSTS_FOR_PATTERNS;

  const posts = await loadPosts(ctx, input.marketId, from, to);
  const patterns = findPatterns(posts, minSample);
  const enough = posts.length >= minPosts;
  const fallback = posts.filter((p) => !p.isExactD7).length;
  const caveats: string[] = [];
  if (posts.length === 0) caveats.push("No post has numbers at day 7 in the window yet.");
  else if (!enough) {
    caveats.push(
      `Only ${posts.length} posts have numbers at day 7 (patterns need ${minPosts}); the pattern lists are left empty.`,
    );
  } else if (posts.length < 40) {
    caveats.push(`Only ${posts.length} posts; patterns are directional, not proof.`);
  }
  if (fallback > 0) {
    caveats.push(`${fallback} of the posts were measured between day 3 and day 6, not at day 7.`);
  }
  if (!input.marketId) {
    caveats.push("Across markets: each post is compared with the median of its own market.");
  }

  const memory = fitSummary({
    marketCode,
    window: { from: dayOf(from), to: dayOf(new Date(to.getTime() - DAY_MS)) },
    basis: { publications: posts.length, metric: "D7", minSample },
    topPatterns: enough ? patterns.top : [],
    weakPatterns: enough ? patterns.weak : [],
    overusedThemes: (await findOverusedThemes(ctx, { marketId: input.marketId, now })).slice(
      0,
      MAX_LIST,
    ),
    coverageGaps: (await findCoverageGaps(ctx, { marketId: input.marketId, now })).slice(
      0,
      MAX_LIST,
    ),
    untestedHypotheses: await loadUntested(ctx, input.marketId, from, to),
    offerPriorities: await loadOffers(ctx, input.marketId, from, to),
    feedback: await loadFeedback(ctx, input.marketId, from, to),
    caveats,
  });

  const [row] = await ctx.db
    .insert(schema.performanceSummaries)
    .values({
      marketId: input.marketId,
      windowStart: memory.window.from,
      windowEnd: memory.window.to,
      summaryJson: memory,
      statsJson: patterns.stats,
      minSample,
      publicationsCount: posts.length,
      createdByType: ctx.actor.type,
    })
    .returning({ id: schema.performanceSummaries.id });
  if (!row) throw new Error("performance summary: insert returned no row");
  return { summaryId: row.id, marketId: input.marketId, memory, stats: patterns.stats };
}
