import { schema } from "@rc/db";
import type { KnowledgeSnapshot } from "@rc/db/json";
import { and, asc, cosineDistance, desc, eq, inArray, isNotNull, or } from "@rc/db/orm";
import { NotFoundError, ValidationError } from "@rc/lib/errors";
import { embedTexts } from "@rc/lib/providers/embeddings";
import type { ServiceContext } from "../../core";
import { selectMmr } from "./mmr";

// Retrieval over approved knowledge (plan 07 §7.9.1). Only CHEF_APPROVED cards with a vector are
// ever returned: nothing unreviewed reaches the idea or writing stages.

export const POOL_LIMIT = 60;
export const MIN_POOL = 40;
export const MMR_LAMBDA = 0.7;
export const DIGEST_CLAIM_CHARS = 200;
/** Candidates beyond this many (newest approved first) are not considered; the corpus is far smaller. */
const MAX_CANDIDATES = 2000;

/** A card as the idea stage sees it. */
export type CardDigest = {
  id: string;
  category: string;
  title: string;
  /** At most 200 characters. */
  claim: string;
  language: string;
  /** Approved version, for citing the exact snapshot. */
  version: number;
};

/** Cuts at a word boundary and adds an ellipsis when the text is longer than `max`. */
export function truncateClaim(claim: string, max = DIGEST_CLAIM_CHARS): string {
  if (claim.length <= max) return claim;
  const cut = claim.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export type CandidatePoolOptions = {
  /** Focus filters. */
  categories?: readonly string[];
  language?: string;
  /** Cards used as PRIMARY in ideas of the last 30 days; the caller (idea stage) knows them. */
  recentlyUsedIds?: readonly string[];
  /**
   * Relevance multipliers per category: above 1 boosts a coverage gap, below 1 penalizes an
   * overused category. Missing categories count as 1.
   */
  categoryWeights?: Readonly<Record<string, number>>;
  /** Default 60. */
  limit?: number;
  /** The recent-use exclusion is dropped when it would leave fewer cards than this. Default 40. */
  minPool?: number;
  lambda?: number;
};

export type CandidatePool = {
  cards: CardDigest[];
  /** Approved cards that matched the filters before exclusion and selection. */
  matched: number;
  /** False when the exclusion would have left fewer than `minPool` cards, so it was skipped. */
  exclusionApplied: boolean;
};

const approved = and(
  eq(schema.knowledgeItems.reviewStatus, "CHEF_APPROVED"),
  isNotNull(schema.knowledgeItems.embedding),
);

const digestColumns = {
  id: schema.knowledgeItems.id,
  category: schema.knowledgeItems.category,
  title: schema.knowledgeItems.title,
  claim: schema.knowledgeItems.claim,
  language: schema.knowledgeItems.language,
  version: schema.knowledgeItems.approvedVersion,
};

const toDigest = (row: {
  id: string;
  category: string;
  title: string;
  claim: string;
  language: string;
  version: number | null;
}): CardDigest => ({
  id: row.id,
  category: row.category,
  title: row.title,
  claim: truncateClaim(row.claim),
  language: row.language,
  version: row.version ?? 1,
});

/**
 * The cards the idea generator may use: approved cards that match the focus filters, without the
 * ones used as PRIMARY recently (unless that leaves fewer than 40), at most 60, chosen by MMR
 * (λ 0.7) over their vectors so the set covers different ground. Category weights steer relevance.
 */
export async function candidatePool(
  ctx: ServiceContext,
  options: CandidatePoolOptions = {},
): Promise<CandidatePool> {
  const limit = options.limit ?? POOL_LIMIT;
  const minPool = options.minPool ?? MIN_POOL;
  const filters = [
    approved,
    options.categories?.length
      ? inArray(schema.knowledgeItems.category, [...options.categories])
      : undefined,
    options.language ? eq(schema.knowledgeItems.language, options.language) : undefined,
  ];
  const rows = await ctx.db
    .select({ ...digestColumns, vector: schema.knowledgeItems.embedding })
    .from(schema.knowledgeItems)
    .where(and(...filters))
    .orderBy(desc(schema.knowledgeItems.approvedAt), asc(schema.knowledgeItems.id))
    .limit(MAX_CANDIDATES);

  const recent = new Set(options.recentlyUsedIds ?? []);
  const fresh = rows.filter((row) => !recent.has(row.id));
  const exclusionApplied = recent.size > 0 && fresh.length >= minPool;
  const pool = exclusionApplied || recent.size === 0 ? fresh : rows;

  const byId = new Map(pool.map((row) => [row.id, row]));
  const picked = selectMmr(
    pool.map((row) => ({
      id: row.id,
      vector: row.vector ?? [],
      relevance: options.categoryWeights?.[row.category] ?? 1,
    })),
    limit,
    options.lambda ?? MMR_LAMBDA,
  );
  return {
    cards: picked.flatMap((id) => {
      const row = byId.get(id);
      return row ? [toDigest(row)] : [];
    }),
    matched: rows.length,
    exclusionApplied,
  };
}

export type SearchOptions = {
  query: string;
  /** Default 10. */
  limit?: number;
  categories?: readonly string[];
  language?: string;
  /** Cosine similarity floor (0–1); weaker matches are left out. */
  minSimilarity?: number;
};

export type SearchHit = CardDigest & { similarity: number };

/**
 * Semantic search over approved cards (manual idea creation): the query is embedded and compared
 * with the card vectors; filters narrow the set. Best match first.
 */
export async function searchApproved(
  ctx: ServiceContext,
  options: SearchOptions,
): Promise<SearchHit[]> {
  const query = options.query.trim();
  if (!query) throw new ValidationError("Enter something to search for.");
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  const [embedded] = await embedTexts(ctx.embeddings, [query], { purpose: "query" });
  if (!embedded) return [];

  const distance = cosineDistance(schema.knowledgeItems.embedding, embedded.vector);
  const rows = await ctx.db
    .select({ ...digestColumns, distance })
    .from(schema.knowledgeItems)
    .where(
      and(
        approved,
        options.categories?.length
          ? inArray(schema.knowledgeItems.category, [...options.categories])
          : undefined,
        options.language ? eq(schema.knowledgeItems.language, options.language) : undefined,
      ),
    )
    .orderBy(distance, asc(schema.knowledgeItems.id))
    .limit(limit);
  return rows
    .map((row) => ({
      ...toDigest(row),
      similarity: Math.round((1 - Number(row.distance)) * 10_000) / 10_000,
    }))
    .filter(
      (hit) => options.minSimilarity === undefined || hit.similarity >= options.minSimilarity,
    );
}

/**
 * The approved snapshots (`knowledge_item_versions`) of the given card versions: the exact text
 * an idea or a draft was built from, whatever happened to the card since. Throws NotFoundError
 * when a version does not exist. `getIdeaCards(ideaId)` (M2-06a) resolves an idea's links and
 * calls this.
 */
export async function getApprovedSnapshots(
  ctx: ServiceContext,
  refs: readonly { knowledgeItemId: string; version: number }[],
): Promise<(KnowledgeSnapshot & { id: string; version: number })[]> {
  if (refs.length === 0) return [];
  const rows = await ctx.db
    .select()
    .from(schema.knowledgeItemVersions)
    .where(
      or(
        ...refs.map((ref) =>
          and(
            eq(schema.knowledgeItemVersions.knowledgeItemId, ref.knowledgeItemId),
            eq(schema.knowledgeItemVersions.version, ref.version),
          ),
        ),
      ),
    );
  const found = new Map(rows.map((r) => [`${r.knowledgeItemId}@${r.version}`, r]));
  const missing = refs.filter((ref) => !found.has(`${ref.knowledgeItemId}@${ref.version}`));
  if (missing.length > 0) {
    throw new NotFoundError("Some approved card versions do not exist.", { details: { missing } });
  }
  return refs.flatMap((ref) => {
    const row = found.get(`${ref.knowledgeItemId}@${ref.version}`);
    return row ? [{ ...row.snapshot, id: ref.knowledgeItemId, version: ref.version }] : [];
  });
}
