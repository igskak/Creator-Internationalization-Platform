import { schema } from "@rc/db";
import {
  and,
  arrayOverlaps,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
  type SQL,
  sql,
} from "@rc/db/orm";
import { z } from "zod";
import type { ServiceContext } from "../../core";

// The Knowledge Base list (plan 10 §10.2 `/knowledge/cards`, 07 §7.2.8): filters, text search,
// status counts, facet counts for the filters and the review order.

export const CARD_STATUSES = ["EXTRACTED", "NEEDS_REVIEW", "CHEF_APPROVED", "ARCHIVED"] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

export const CARD_FLAGS = [
  "QUOTE_UNVERIFIED",
  "LOW_CONFIDENCE",
  "DUPLICATE_SUSPECTED",
  "SAFETY_SENSITIVE",
] as const;

export const CARD_SORTS = ["review", "newest", "confidence"] as const;
export const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
/** One "approve verified" click handles this many cards (bulk transitions take at most 100). */
export const APPROVE_BATCH = 100;

export const ListCardsInput = z.object({
  statuses: z.array(z.enum(CARD_STATUSES)).optional(),
  categories: z.array(z.string().min(1)).optional(),
  sourceIds: z.array(z.uuid()).optional(),
  /** A card matches when it has any of these flags. */
  flags: z.array(z.enum(CARD_FLAGS)).optional(),
  language: z.string().min(2).max(10).optional(),
  /** Text search in title, claim and explanation (case-insensitive). */
  q: z.string().trim().max(200).optional(),
  sort: z.enum(CARD_SORTS).default("review"),
  /** Categories to show first in the review order (the editor's focus set). */
  focusCategories: z.array(z.string().min(1)).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListCardsInput = z.input<typeof ListCardsInput>;

export type CardRow = {
  id: string;
  title: string;
  claim: string;
  category: string;
  subcategory: string | null;
  status: CardStatus;
  flags: string[];
  safetySensitive: boolean;
  confidence: number | null;
  /** Null for cards without a source quote (manual cards). */
  quoteVerified: boolean | null;
  matchScore: number | null;
  language: string;
  sourceId: string | null;
  sourceTitle: string | null;
  pageStart: number | null;
  version: number;
  approvedVersion: number | null;
  duplicateOfId: string | null;
  createdAt: Date;
};

type Facet = { value: string; label?: string; count: number };

export type CardList = {
  rows: CardRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Counts per status with every other filter applied. */
  statusCounts: Record<CardStatus, number>;
  /** Counts for the filter dropdowns; each ignores its own filter so the choices stay visible. */
  facets: { categories: Facet[]; flags: Facet[]; sources: Facet[]; languages: Facet[] };
  /** Cards of this list that could be approved in bulk: verified quote and no flags. */
  approvable: { count: number; ids: string[] };
};

const t = schema.knowledgeItems;
const quoteVerifiedSql = sql<boolean | null>`(${t.sourceReference}->>'quoteVerified')::boolean`;

/** Escapes LIKE wildcards so a search for "50%" finds "50%". */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

type Dimension = "status" | "category" | "flag" | "source" | "language";

function conditions(input: z.output<typeof ListCardsInput>, skip?: Dimension): (SQL | undefined)[] {
  return [
    skip !== "status" && input.statuses?.length
      ? inArray(t.reviewStatus, input.statuses)
      : undefined,
    skip !== "category" && input.categories?.length
      ? inArray(t.category, input.categories)
      : undefined,
    skip !== "source" && input.sourceIds?.length
      ? inArray(t.sourceAssetId, input.sourceIds)
      : undefined,
    skip !== "flag" && input.flags?.length ? arrayOverlaps(t.reviewFlags, input.flags) : undefined,
    skip !== "language" && input.language ? eq(t.language, input.language) : undefined,
    input.q
      ? or(
          ilike(t.title, likePattern(input.q)),
          ilike(t.claim, likePattern(input.q)),
          ilike(t.explanation, likePattern(input.q)),
        )
      : undefined,
  ];
}

/** The review order of 07 §7.2.8; other sorts for browsing. */
function orderBy(input: z.output<typeof ListCardsInput>): SQL[] {
  if (input.sort === "newest") return [desc(t.createdAt), asc(t.id)];
  if (input.sort === "confidence") return [desc(t.confidence), asc(t.id)];
  const focus = input.focusCategories?.length
    ? [sql`(case when ${inArray(t.category, input.focusCategories)} then 0 else 1 end)`]
    : [];
  return [
    // verified quote first (cards without a quote after verified ones, unverified last)
    sql`(case when ${quoteVerifiedSql} is true then 0 when ${quoteVerifiedSql} is null then 1 else 2 end)`,
    desc(t.confidence),
    ...focus,
    desc(schema.sourceAssets.createdAt),
    asc(t.id),
  ];
}

export async function listKnowledgeCards(
  ctx: ServiceContext,
  raw: ListCardsInput = {},
): Promise<CardList> {
  const input = ListCardsInput.parse(raw);
  const where = (skip?: Dimension) => and(...conditions(input, skip));

  const [
    rows,
    [totalRow],
    statusRows,
    categoryRows,
    flagRows,
    sourceRows,
    languageRows,
    approvableRows,
  ] = await Promise.all([
    ctx.db
      .select({
        id: t.id,
        title: t.title,
        claim: t.claim,
        category: t.category,
        subcategory: t.subcategory,
        status: t.reviewStatus,
        flags: t.reviewFlags,
        safetySensitive: t.safetySensitive,
        confidence: t.confidence,
        quoteVerified: quoteVerifiedSql,
        matchScore: sql<number | null>`(${t.sourceReference}->>'matchScore')::float`,
        language: t.language,
        sourceId: t.sourceAssetId,
        sourceTitle: schema.sourceAssets.title,
        pageStart: sql<number | null>`(${t.sourceReference}->>'pageStart')::int`,
        version: t.version,
        approvedVersion: t.approvedVersion,
        duplicateOfId: t.duplicateOfId,
        createdAt: t.createdAt,
      })
      .from(t)
      .leftJoin(schema.sourceAssets, eq(schema.sourceAssets.id, t.sourceAssetId))
      .where(where())
      .orderBy(...orderBy(input))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    ctx.db.select({ n: count() }).from(t).where(where()),
    ctx.db
      .select({ value: t.reviewStatus, n: count() })
      .from(t)
      .where(where("status"))
      .groupBy(t.reviewStatus),
    ctx.db
      .select({ value: t.category, n: count() })
      .from(t)
      .where(where("category"))
      .groupBy(t.category),
    ctx.db
      .select({ value: sql<string>`unnest(${t.reviewFlags})`, n: count() })
      .from(t)
      .where(where("flag"))
      .groupBy(sql`1`),
    ctx.db
      .select({ value: t.sourceAssetId, label: schema.sourceAssets.title, n: count() })
      .from(t)
      .leftJoin(schema.sourceAssets, eq(schema.sourceAssets.id, t.sourceAssetId))
      .where(where("source"))
      .groupBy(t.sourceAssetId, schema.sourceAssets.title),
    ctx.db
      .select({ value: t.language, n: count() })
      .from(t)
      .where(where("language"))
      .groupBy(t.language),
    ctx.db
      .select({ id: t.id })
      .from(t)
      .leftJoin(schema.sourceAssets, eq(schema.sourceAssets.id, t.sourceAssetId))
      .where(
        and(
          ...conditions(input),
          eq(t.reviewStatus, "NEEDS_REVIEW"),
          sql`${quoteVerifiedSql} is not false`,
          sql`${t.sourceReference} is not null`,
          sql`cardinality(${t.reviewFlags}) = 0`,
        ),
      )
      .orderBy(...orderBy(input)),
  ]);

  const statusCounts = Object.fromEntries(CARD_STATUSES.map((s) => [s, 0])) as Record<
    CardStatus,
    number
  >;
  for (const row of statusRows) statusCounts[row.value] = row.n;
  const byCount = (a: Facet, b: Facet) => b.count - a.count || a.value.localeCompare(b.value);

  return {
    rows: rows.map((row) => ({
      ...row,
      confidence: row.confidence === null ? null : Number(row.confidence),
    })),
    total: totalRow?.n ?? 0,
    page: input.page,
    pageSize: input.pageSize,
    statusCounts,
    facets: {
      categories: categoryRows.map((r) => ({ value: r.value, count: r.n })).sort(byCount),
      flags: CARD_FLAGS.map((flag) => ({
        value: flag,
        count: flagRows.find((r) => r.value === flag)?.n ?? 0,
      })),
      sources: sourceRows
        .flatMap((r) =>
          r.value ? [{ value: r.value, label: r.label ?? r.value, count: r.n }] : [],
        )
        .sort(byCount),
      languages: languageRows.map((r) => ({ value: r.value, count: r.n })).sort(byCount),
    },
    approvable: {
      count: approvableRows.length,
      ids: approvableRows.slice(0, APPROVE_BATCH).map((r) => r.id),
    },
  };
}
