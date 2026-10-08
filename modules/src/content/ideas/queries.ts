import { schema } from "@rc/db";
import { asc, count, desc, eq, inArray, sql } from "@rc/db/orm";
import { NotFoundError } from "@rc/lib/errors";
import { z } from "zod";
import type { ServiceContext } from "../../core";
import { listKnowledgeCards } from "../../knowledge/cards";
import { getIdeaCards, truncateClaim } from "../../knowledge/retrieval";

// Reads for the ideas screens (plan 10 §10.2, M2-08).

export const IDEA_STATUSES = ["PROPOSED", "ACCEPTED", "REJECTED", "ARCHIVED"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

export const DEFAULT_IDEAS_PAGE_SIZE = 20;

export const ListIdeasInput = z.object({
  status: z.enum(IDEA_STATUSES).default("PROPOSED"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(DEFAULT_IDEAS_PAGE_SIZE),
});
export type ListIdeasInput = z.input<typeof ListIdeasInput>;

export type IdeaListRow = {
  id: string;
  topic: string;
  coreMessage: string;
  category: string;
  angle: string;
  commercialIntent: "NONE" | "LEAD_MAGNET" | "PRODUCT_SALE" | "NURTURE";
  productName: string | null;
  origin: "AI_GENERATED" | "MANUAL";
  status: IdeaStatus;
  cardCount: number;
  createdAt: Date;
};

export type IdeaList = {
  rows: IdeaListRow[];
  /** Ideas with the requested status. */
  total: number;
  page: number;
  pageSize: number;
  /** Ideas per status, for the tabs. */
  statusCounts: Record<IdeaStatus, number>;
};

const ideas = schema.masterIdeas;

/** Ideas of one status, newest first, with the number of linked cards and the product name. */
export async function listIdeas(ctx: ServiceContext, raw: ListIdeasInput = {}): Promise<IdeaList> {
  const input = ListIdeasInput.parse(raw);
  const [rows, [totalRow], statusRows] = await Promise.all([
    ctx.db
      .select({
        id: ideas.id,
        topic: ideas.topic,
        coreMessage: ideas.coreMessage,
        category: ideas.category,
        angle: ideas.angle,
        commercialIntent: ideas.commercialIntent,
        productName: schema.products.name,
        origin: ideas.origin,
        status: ideas.status,
        createdAt: ideas.createdAt,
        cardCount: sql<number>`(select count(*)::int from ${schema.masterIdeaKnowledge} where ${schema.masterIdeaKnowledge.masterIdeaId} = ${ideas.id})`,
      })
      .from(ideas)
      .leftJoin(schema.products, eq(schema.products.id, ideas.productId))
      .where(eq(ideas.status, input.status))
      .orderBy(desc(ideas.createdAt), asc(ideas.id))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    ctx.db.select({ n: count() }).from(ideas).where(eq(ideas.status, input.status)),
    ctx.db.select({ status: ideas.status, n: count() }).from(ideas).groupBy(ideas.status),
  ]);
  const statusCounts: Record<IdeaStatus, number> = {
    PROPOSED: 0,
    ACCEPTED: 0,
    REJECTED: 0,
    ARCHIVED: 0,
  };
  for (const row of statusRows) statusCounts[row.status] = row.n;
  return {
    rows,
    total: totalRow?.n ?? 0,
    page: input.page,
    pageSize: input.pageSize,
    statusCounts,
  };
}

export type IdeaDetailCard = {
  id: string;
  /** Approved version the idea is linked to. */
  version: number;
  role: "PRIMARY" | "SUPPORTING";
  title: string;
  category: string;
  claim: string;
  explanation: string;
  language: string;
  /** The verbatim quote of the linked version and its first page. */
  quote: string | null;
  page: number | null;
  sourceId: string | null;
  sourceTitle: string | null;
  /** Status of the card now; anything but CHEF_APPROVED means it changed after the link. */
  currentStatus: string;
  currentApprovedVersion: number | null;
  safetySensitive: boolean;
};

export type IdeaDetail = {
  idea: typeof ideas.$inferSelect;
  product: { id: string; code: string; name: string } | null;
  cards: IdeaDetailCard[];
  variants: { id: string; marketCode: string; status: string }[];
  /** `updateIdea` would accept an edit now (plan 05 §5.6). */
  canEdit: boolean;
};

/** One idea with the approved snapshots of its cards (what it was built from) and its variants. */
export async function getIdeaDetail(ctx: ServiceContext, id: string): Promise<IdeaDetail> {
  const [idea] = await ctx.db.select().from(ideas).where(eq(ideas.id, id));
  if (!idea) throw new NotFoundError("Idea not found.", { details: { id } });

  const snapshots = await getIdeaCards(ctx, id);
  const cardIds = snapshots.map((c) => c.id);
  const current = cardIds.length
    ? await ctx.db
        .select({
          id: schema.knowledgeItems.id,
          status: schema.knowledgeItems.reviewStatus,
          approvedVersion: schema.knowledgeItems.approvedVersion,
          sourceId: schema.knowledgeItems.sourceAssetId,
          sourceTitle: schema.sourceAssets.title,
        })
        .from(schema.knowledgeItems)
        .leftJoin(
          schema.sourceAssets,
          eq(schema.sourceAssets.id, schema.knowledgeItems.sourceAssetId),
        )
        .where(inArray(schema.knowledgeItems.id, cardIds))
    : [];
  const byId = new Map(current.map((c) => [c.id, c]));

  const [product] = idea.productId
    ? await ctx.db
        .select({ id: schema.products.id, code: schema.products.code, name: schema.products.name })
        .from(schema.products)
        .where(eq(schema.products.id, idea.productId))
    : [];
  const variants = await ctx.db
    .select({
      id: schema.contentVariants.id,
      marketCode: schema.markets.code,
      status: schema.contentVariants.status,
    })
    .from(schema.contentVariants)
    .innerJoin(schema.markets, eq(schema.markets.id, schema.contentVariants.marketId))
    .where(eq(schema.contentVariants.masterIdeaId, id))
    .orderBy(asc(schema.markets.sortOrder), asc(schema.markets.code));

  return {
    idea,
    product: product ?? null,
    cards: snapshots.map((card) => {
      const now = byId.get(card.id);
      return {
        id: card.id,
        version: card.version,
        role: card.role,
        title: card.title,
        category: card.category,
        claim: card.claim,
        explanation: card.explanation,
        language: card.language,
        quote: card.sourceReference?.quote || null,
        page: card.sourceReference?.pageStart ?? null,
        sourceId: now?.sourceId ?? null,
        sourceTitle: now?.sourceTitle ?? null,
        currentStatus: now?.status ?? "ARCHIVED",
        currentApprovedVersion: now?.approvedVersion ?? null,
        safetySensitive: card.safetySensitive,
      };
    }),
    variants,
    canEdit:
      (idea.status === "PROPOSED" || idea.status === "ACCEPTED") &&
      variants.every((v) => v.status === "DRAFT" || v.status === "REJECTED"),
  };
}

export type CardChoice = {
  id: string;
  title: string;
  /** Cut to 200 characters. */
  claim: string;
  category: string;
  language: string;
  /** The approved version a link would store. */
  version: number;
};

export const SearchCardsInput = z.object({ q: z.string().trim().max(200).default("") });

/**
 * Approved cards for the picker of the manual idea form: newest first, filtered by a text search
 * in title, claim and explanation. At most 15, so the list stays short.
 */
export async function searchCardsForIdea(
  ctx: ServiceContext,
  raw: z.input<typeof SearchCardsInput> = {},
): Promise<CardChoice[]> {
  const { q } = SearchCardsInput.parse(raw);
  const list = await listKnowledgeCards(ctx, {
    statuses: ["CHEF_APPROVED"],
    ...(q ? { q } : {}),
    sort: "newest",
    pageSize: 15,
  });
  return list.rows.map((row) => ({
    id: row.id,
    title: row.title,
    claim: truncateClaim(row.claim),
    category: row.category,
    language: row.language,
    version: row.approvedVersion ?? row.version,
  }));
}

/** Convenience for the edit form: the links of an idea as the picker's initial choice. */
export async function getIdeaForEdit(ctx: ServiceContext, id: string) {
  const detail = await getIdeaDetail(ctx, id);
  return {
    ...detail,
    linked: detail.cards.map((c) => ({ id: c.id, role: c.role, title: c.title })),
  };
}

/** Active products an idea can feature (the offers screen of M2-02 manages them). */
export async function listActiveProducts(
  ctx: ServiceContext,
): Promise<{ id: string; code: string; name: string }[]> {
  return ctx.db
    .select({ id: schema.products.id, code: schema.products.code, name: schema.products.name })
    .from(schema.products)
    .where(eq(schema.products.status, "ACTIVE"))
    .orderBy(asc(schema.products.name), asc(schema.products.code));
}
