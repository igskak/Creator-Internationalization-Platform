import { schema } from "@rc/db";
import { and, count, desc, eq, inArray, sql } from "@rc/db/orm";
import { z } from "zod";
import type { ServiceContext } from "../../core";
import type { VariantStatus } from "./state";

// Reads for the draft queue, the dashboard counters and the sidebar badges (plan 10 §10.2, M4-07).

/** The tabs of the draft queue: groups of statuses a person thinks of together. */
export const DRAFT_TABS = {
  REVIEW: ["DRAFT", "GENERATING", "READY_FOR_REVIEW", "CHANGES_REQUESTED"],
  APPROVED: ["APPROVED"],
  SCHEDULED: ["SCHEDULED", "PUBLISHING"],
  PUBLISHED: ["PUBLISHED"],
  FAILED: ["FAILED"],
  REJECTED: ["REJECTED"],
} as const satisfies Record<string, readonly VariantStatus[]>;
export type DraftTab = keyof typeof DRAFT_TABS;
export const DRAFT_TAB_KEYS = Object.keys(DRAFT_TABS) as DraftTab[];

export const DEFAULT_DRAFTS_PAGE_SIZE = 25;

export const ListDraftsInput = z.object({
  tab: z.enum(DRAFT_TAB_KEYS as [DraftTab, ...DraftTab[]]).default("REVIEW"),
  /** `markets.code`. */
  market: z.string().min(1).max(20).optional(),
  /** Only drafts that carry at least one flag. */
  flagged: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(DEFAULT_DRAFTS_PAGE_SIZE),
});
export type ListDraftsInput = z.input<typeof ListDraftsInput>;

export type DraftRow = {
  variantId: string;
  ideaId: string;
  ideaTopic: string;
  marketCode: string;
  marketName: string;
  flagEmoji: string | null;
  /** A Reel opens on the same review page as its carousel (its card sits in the market's column). */
  format: "CAROUSEL" | "REEL" | "SINGLE_IMAGE";
  status: VariantStatus;
  /** 1–5, null while there is no review. */
  qualityScore: number | null;
  flags: string[];
  updatedAt: Date;
  /** Who touched it last (display name or e-mail), from the review events; null if nobody did. */
  reviewer: string | null;
};

export type DraftList = {
  rows: DraftRow[];
  /** Drafts of the requested tab (and market, and flag filter). */
  total: number;
  page: number;
  pageSize: number;
  /** Drafts per tab, for the tab labels; the market and flag filters apply. */
  tabCounts: Record<DraftTab, number>;
};

const v = schema.contentVariants;

/** The draft queue: variants of the tab, most recently changed first. */
export async function listDrafts(
  ctx: ServiceContext,
  raw: ListDraftsInput = {},
): Promise<DraftList> {
  const input = ListDraftsInput.parse(raw);
  const filters = [
    ...(input.market ? [eq(schema.markets.code, input.market)] : []),
    ...(input.flagged ? [sql`cardinality(${v.flags}) > 0`] : []),
  ];
  const [rows, [totalRow], statusRows] = await Promise.all([
    ctx.db
      .select({
        variantId: v.id,
        ideaId: v.masterIdeaId,
        ideaTopic: schema.masterIdeas.topic,
        marketCode: schema.markets.code,
        marketName: schema.markets.displayName,
        flagEmoji: schema.markets.flagEmoji,
        format: v.format,
        status: v.status,
        qualityScore: v.qualityScore,
        flags: v.flags,
        updatedAt: v.updatedAt,
        reviewer: sql<
          string | null
        >`(select coalesce(u.display_name, u.email) from ${schema.reviewEvents} e join ${schema.appUsers} u on u.id = e.reviewer_id where e.content_variant_id = ${v.id} order by e.created_at desc limit 1)`,
      })
      .from(v)
      .innerJoin(schema.masterIdeas, eq(schema.masterIdeas.id, v.masterIdeaId))
      .innerJoin(schema.markets, eq(schema.markets.id, v.marketId))
      .where(and(inArray(v.status, [...DRAFT_TABS[input.tab]]), ...filters))
      .orderBy(desc(v.updatedAt), desc(v.id))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    ctx.db
      .select({ n: count() })
      .from(v)
      .innerJoin(schema.markets, eq(schema.markets.id, v.marketId))
      .where(and(inArray(v.status, [...DRAFT_TABS[input.tab]]), ...filters)),
    ctx.db
      .select({ status: v.status, n: count() })
      .from(v)
      .innerJoin(schema.markets, eq(schema.markets.id, v.marketId))
      .where(and(...filters))
      .groupBy(v.status),
  ]);
  const byStatus = new Map(statusRows.map((r) => [r.status, Number(r.n)]));
  const tabCounts = Object.fromEntries(
    DRAFT_TAB_KEYS.map((tab) => [
      tab,
      DRAFT_TABS[tab].reduce((sum, status) => sum + (byStatus.get(status) ?? 0), 0),
    ]),
  ) as Record<DraftTab, number>;
  return {
    rows: rows.map((r) => ({
      ...r,
      qualityScore: r.qualityScore === null ? null : Number(r.qualityScore),
    })),
    total: Number(totalRow?.n ?? 0),
    page: input.page,
    pageSize: input.pageSize,
    tabCounts,
  };
}

/** What waits for a person (plan 10 §10.2 dashboard counters); also the sidebar badges. */
export type WorkQueue = {
  cardsToReview: number;
  ideasProposed: number;
  draftsReady: number;
  changesRequested: number;
  approvedNotScheduled: number;
  /** Publications SCHEDULED or QUEUED to go out within the next 7 days (late ones included). */
  scheduledNext7Days: number;
  failed: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The counters in one query (the layout asks for them on every page); carousels and Reels alike. */
export async function getWorkQueue(ctx: ServiceContext): Promise<WorkQueue> {
  const horizon = new Date(ctx.clock.now().getTime() + 7 * DAY_MS);
  const variants = (status: VariantStatus) =>
    sql<number>`(select count(*)::int from ${v} where ${v.status} = ${status})`;
  const [row] = await ctx.db
    .select({
      cardsToReview: sql<number>`(select count(*)::int from ${schema.knowledgeItems} where ${schema.knowledgeItems.reviewStatus} = 'NEEDS_REVIEW')`,
      ideasProposed: sql<number>`(select count(*)::int from ${schema.masterIdeas} where ${schema.masterIdeas.status} = 'PROPOSED')`,
      draftsReady: variants("READY_FOR_REVIEW"),
      changesRequested: variants("CHANGES_REQUESTED"),
      approvedNotScheduled: variants("APPROVED"),
      scheduledNext7Days: sql<number>`(select count(*)::int from ${schema.publications} where ${schema.publications.dryRun} = false and ${schema.publications.status} in ('SCHEDULED', 'QUEUED') and ${schema.publications.scheduledAt} <= ${horizon.toISOString()}::timestamptz)`,
      failed: variants("FAILED"),
    })
    .from(sql`(select 1) as one`);
  return {
    cardsToReview: Number(row?.cardsToReview ?? 0),
    ideasProposed: Number(row?.ideasProposed ?? 0),
    draftsReady: Number(row?.draftsReady ?? 0),
    changesRequested: Number(row?.changesRequested ?? 0),
    approvedNotScheduled: Number(row?.approvedNotScheduled ?? 0),
    scheduledNext7Days: Number(row?.scheduledNext7Days ?? 0),
    failed: Number(row?.failed ?? 0),
  };
}
