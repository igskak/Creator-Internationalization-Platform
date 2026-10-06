import { schema } from "@rc/db";
import type { KnowledgeGloss, SourceReference } from "@rc/db/json";
import { and, asc, between, desc, eq } from "@rc/db/orm";
import { NotFoundError } from "@rc/lib/errors";
import type { ServiceContext } from "../../core";
import { locateQuote } from "../extraction";
import { glossTextHash } from "./gloss";
import type { CardStatus } from "./list";
import { ideasUsingCards } from "./usage";

// The data of the card review screen (plan 05 §5.4 `getCardWithEvidence`, 10 §10.2).

type Card = typeof schema.knowledgeItems.$inferSelect;
type Source = typeof schema.sourceAssets.$inferSelect;

/** A card without its embedding (a 1,536-number vector the screen never needs). */
export type CardView = Omit<
  Card,
  "embedding" | "confidence" | "reviewStatus" | "reviewFlags" | "glossEn"
> & {
  confidence: number | null;
  status: CardStatus;
  flags: string[];
};

export type EvidencePage = {
  pageNumber: number;
  text: string;
  sectionPath: string | null;
  /** The card cites this page (the other pages are the neighbours, for context). */
  cited: boolean;
  /** Where the quote stands in `text`; only on a cited page that contains it. */
  quoteRange: { start: number; end: number } | null;
};

export type CardVersionView = {
  version: number;
  status: CardStatus;
  createdAt: Date;
  changedBy: string | null;
  changeNote: string | null;
  title: string;
  claim: string;
};

export type CardDetail = {
  card: CardView;
  versions: CardVersionView[];
  source: { id: string; title: string; type: string; hasFile: boolean; isPdf: boolean } | null;
  pages: EvidencePage[];
  duplicateOf: { id: string; title: string } | null;
  /** The English reading aid, if one was made; `stale` when the card text changed since. Not approved text. */
  gloss: (KnowledgeGloss & { stale: boolean }) | null;
  /** Ideas that use the card; filled in when ideas exist (M2-06a). */
  usedByIdeas: { id: string; topic: string }[];
};

export function toCardView(card: Card): CardView {
  const {
    embedding: _embedding,
    glossEn: _gloss,
    confidence,
    reviewStatus,
    reviewFlags,
    ...rest
  } = card;
  return {
    ...rest,
    confidence: confidence === null ? null : Number(confidence),
    status: reviewStatus,
    flags: reviewFlags,
  };
}

/**
 * The text of the pages a card cites plus one page on each side, from the source's current
 * processing attempt. Empty for cards without a source quote.
 */
export async function loadEvidencePages(
  ctx: ServiceContext,
  card: Pick<Card, "sourceAssetId" | "sourceReference">,
  source: Pick<Source, "processingAttempt"> | null,
): Promise<EvidencePage[]> {
  const ref: SourceReference | null = card.sourceReference;
  if (!card.sourceAssetId || !source || !ref?.pageStart) return [];
  const pageEnd = ref.pageEnd ?? ref.pageStart;
  const rows = await ctx.db
    .select()
    .from(schema.sourcePages)
    .where(
      and(
        eq(schema.sourcePages.sourceAssetId, card.sourceAssetId),
        eq(schema.sourcePages.processingAttempt, source.processingAttempt),
        between(schema.sourcePages.pageNumber, Math.max(1, ref.pageStart - 1), pageEnd + 1),
      ),
    )
    .orderBy(asc(schema.sourcePages.pageNumber));

  let located = false;
  return rows.map((row) => {
    const cited = row.pageNumber >= ref.pageStart! && row.pageNumber <= pageEnd;
    // Highlight the quote once, on the first cited page that has it.
    const quoteRange = cited && !located ? locateQuote(row.text, ref.quote) : null;
    if (quoteRange) located = true;
    return {
      pageNumber: row.pageNumber,
      text: row.text,
      sectionPath: row.sectionPath,
      cited,
      quoteRange,
    };
  });
}

/**
 * One card with everything the review screen shows: the cited pages with the quote located, the
 * version history, the source and the card it may duplicate. NotFoundError for an unknown id.
 */
export async function getCardWithEvidence(ctx: ServiceContext, id: string): Promise<CardDetail> {
  const [card] = await ctx.db
    .select()
    .from(schema.knowledgeItems)
    .where(eq(schema.knowledgeItems.id, id));
  if (!card) throw new NotFoundError("Knowledge card not found.", { details: { id } });

  const [source] = card.sourceAssetId
    ? await ctx.db
        .select()
        .from(schema.sourceAssets)
        .where(eq(schema.sourceAssets.id, card.sourceAssetId))
    : [];
  const [versions, pages, duplicate] = await Promise.all([
    ctx.db
      .select({
        version: schema.knowledgeItemVersions.version,
        status: schema.knowledgeItemVersions.status,
        createdAt: schema.knowledgeItemVersions.createdAt,
        changeNote: schema.knowledgeItemVersions.changeNote,
        snapshot: schema.knowledgeItemVersions.snapshot,
        name: schema.appUsers.displayName,
        email: schema.appUsers.email,
      })
      .from(schema.knowledgeItemVersions)
      .leftJoin(schema.appUsers, eq(schema.appUsers.id, schema.knowledgeItemVersions.changedBy))
      .where(eq(schema.knowledgeItemVersions.knowledgeItemId, id))
      .orderBy(desc(schema.knowledgeItemVersions.version)),
    loadEvidencePages(ctx, card, source ?? null),
    card.duplicateOfId
      ? ctx.db
          .select({ id: schema.knowledgeItems.id, title: schema.knowledgeItems.title })
          .from(schema.knowledgeItems)
          .where(eq(schema.knowledgeItems.id, card.duplicateOfId))
      : Promise.resolve([]),
  ]);

  return {
    card: toCardView(card),
    versions: versions.map((v) => ({
      version: v.version,
      status: v.status,
      createdAt: v.createdAt,
      changedBy: v.name ?? v.email ?? null,
      changeNote: v.changeNote,
      title: v.snapshot.title,
      claim: v.snapshot.claim,
    })),
    source: source
      ? {
          id: source.id,
          title: source.title,
          type: source.type,
          hasFile: Boolean(source.fileKey) && source.processingStatus !== "PENDING_UPLOAD",
          isPdf: (source.originalFilename ?? "").toLowerCase().endsWith(".pdf"),
        }
      : null,
    pages,
    duplicateOf: duplicate[0] ?? null,
    gloss: card.glossEn
      ? { ...card.glossEn, stale: card.glossEn.textHash !== glossTextHash(card) }
      : null,
    usedByIdeas: (await ideasUsingCards(ctx, [id])).get(id) ?? [],
  };
}
