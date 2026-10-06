import { schema } from "@rc/db";
import type { ProcessingError, ProcessingProgress, RightsPolicy, SourceType } from "@rc/db/json";
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, sql } from "@rc/db/orm";
import { NotFoundError, ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import { progressPercent, type ServiceContext } from "../../core";

// Reading sources for the library and the source screen (plan 10 §10.2, M1-04).

type Source = typeof schema.sourceAssets.$inferSelect;
export type ProcessingStatus = Source["processingStatus"];

const PAGE_PREVIEW_COUNT = 3;
const PAGE_PREVIEW_CHARS = 600;
export const SOURCE_LIST_PAGE_SIZE = 25;

export const ListSourcesInput = z.object({
  q: z.string().trim().max(200).optional(),
  status: z
    .enum(["PENDING_UPLOAD", "UPLOADED", "QUEUED", "PROCESSING", "READY", "FAILED", "BLOCKED"])
    .optional(),
  includeArchived: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(SOURCE_LIST_PAGE_SIZE),
});

export type SourceRow = {
  id: string;
  title: string;
  type: SourceType;
  language: string;
  author: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  status: ProcessingStatus;
  /** 0–100 while the source is being processed. */
  percent: number | null;
  progress: ProcessingProgress;
  error: ProcessingError | null;
  rightsStatus: Source["rightsStatus"];
  aiProcessing: RightsPolicy["aiProcessing"];
  pageCount: number | null;
  /** Cards that are not archived. */
  cards: number;
  createdAt: Date;
  archived: boolean;
};

export type SourceList = { rows: SourceRow[]; total: number; page: number; pageSize: number };

const toRow = (s: Source, cards: number): SourceRow => ({
  id: s.id,
  title: s.title,
  type: s.type,
  language: s.originalLanguage,
  author: s.sourceAuthor,
  fileName: s.originalFilename,
  sizeBytes: s.fileSizeBytes,
  status: s.processingStatus,
  percent:
    s.processingStatus === "PROCESSING" ||
    s.processingStatus === "QUEUED" ||
    s.processingStatus === "READY"
      ? progressPercent(s)
      : null,
  progress: s.processingProgress,
  error: s.processingError,
  rightsStatus: s.rightsStatus,
  aiProcessing: s.rights.aiProcessing,
  pageCount: s.pageCount,
  cards,
  createdAt: s.createdAt,
  archived: s.archivedAt !== null,
});

async function cardCounts(ctx: ServiceContext, ids: readonly string[]) {
  if (ids.length === 0) return new Map<string, number>();
  const rows = await ctx.db
    .select({ id: schema.knowledgeItems.sourceAssetId, n: count() })
    .from(schema.knowledgeItems)
    .where(
      and(
        inArray(schema.knowledgeItems.sourceAssetId, [...ids]),
        ne(schema.knowledgeItems.reviewStatus, "ARCHIVED"),
      ),
    )
    .groupBy(schema.knowledgeItems.sourceAssetId);
  return new Map(rows.map((r) => [r.id ?? "", r.n]));
}

/** The library: sources newest first (imports of historical posts have their own screen). */
export async function listSources(
  ctx: ServiceContext,
  raw: z.input<typeof ListSourcesInput> = {},
): Promise<SourceList> {
  const parsed = ListSourcesInput.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const input = parsed.data;
  const like = input.q ? `%${input.q.replace(/[%_\\]/gu, "\\$&")}%` : null;
  const where = and(
    ne(schema.sourceAssets.type, "INSTAGRAM_POST"),
    input.includeArchived ? undefined : isNull(schema.sourceAssets.archivedAt),
    input.status ? eq(schema.sourceAssets.processingStatus, input.status) : undefined,
    like ? ilike(schema.sourceAssets.title, like) : undefined,
  );
  const [totalRow] = await ctx.db.select({ n: count() }).from(schema.sourceAssets).where(where);
  const rows = await ctx.db
    .select()
    .from(schema.sourceAssets)
    .where(where)
    .orderBy(desc(schema.sourceAssets.createdAt), desc(schema.sourceAssets.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);
  const cards = await cardCounts(
    ctx,
    rows.map((r) => r.id),
  );
  return {
    rows: rows.map((r) => toRow(r, cards.get(r.id) ?? 0)),
    total: totalRow?.n ?? 0,
    page: input.page,
    pageSize: input.pageSize,
  };
}

export type SourceDetail = {
  source: SourceRow & { rights: RightsPolicy; metadata: Record<string, unknown>; attempt: number };
  pages: { total: number; withoutText: number; transcribed: number };
  preview: { pageNumber: number; text: string; truncated: boolean; hasTextLayer: boolean }[];
  batches: {
    batchIndex: number;
    pageStart: number;
    pageEnd: number;
    mode: "PDF_NATIVE" | "TEXT";
    status: string;
    cardsCreated: number;
    error: ProcessingError | null;
  }[];
  /** Cards of the source by review status. */
  cardsByStatus: Record<"EXTRACTED" | "NEEDS_REVIEW" | "CHEF_APPROVED" | "ARCHIVED", number>;
  /** Cards whose quote could not be found. */
  unverifiedQuotes: number;
  hasFile: boolean;
  isPdf: boolean;
};

export async function getSourceDetail(ctx: ServiceContext, id: string): Promise<SourceDetail> {
  const [source] = await ctx.db
    .select()
    .from(schema.sourceAssets)
    .where(eq(schema.sourceAssets.id, id));
  if (!source) throw new NotFoundError("Source not found.", { details: { id } });

  const attempt = source.processingAttempt;
  const pageWhere = and(
    eq(schema.sourcePages.sourceAssetId, id),
    eq(schema.sourcePages.processingAttempt, attempt),
  );
  const [counts, preview, batches, byStatus] = await Promise.all([
    ctx.db
      .select({
        total: count(),
        withoutText: sql<number>`count(*) filter (where ${schema.sourcePages.hasTextLayer} = false)`,
        transcribed: sql<number>`count(*) filter (where ${schema.sourcePages.transcribed} = true)`,
      })
      .from(schema.sourcePages)
      .where(pageWhere),
    ctx.db
      .select()
      .from(schema.sourcePages)
      .where(pageWhere)
      .orderBy(asc(schema.sourcePages.pageNumber))
      .limit(PAGE_PREVIEW_COUNT),
    ctx.db
      .select()
      .from(schema.knowledgeExtractionBatches)
      .where(
        and(
          eq(schema.knowledgeExtractionBatches.sourceAssetId, id),
          eq(schema.knowledgeExtractionBatches.processingAttempt, attempt),
        ),
      )
      .orderBy(asc(schema.knowledgeExtractionBatches.batchIndex)),
    ctx.db
      .select({
        status: schema.knowledgeItems.reviewStatus,
        n: count(),
        unverified: sql<number>`count(*) filter (where ${schema.knowledgeItems.reviewFlags} @> array['QUOTE_UNVERIFIED']::text[])`,
      })
      .from(schema.knowledgeItems)
      .where(eq(schema.knowledgeItems.sourceAssetId, id))
      .groupBy(schema.knowledgeItems.reviewStatus),
  ]);

  const cardsByStatus = { EXTRACTED: 0, NEEDS_REVIEW: 0, CHEF_APPROVED: 0, ARCHIVED: 0 };
  let unverifiedQuotes = 0;
  for (const row of byStatus) {
    cardsByStatus[row.status] = row.n;
    if (row.status !== "ARCHIVED") unverifiedQuotes += Number(row.unverified);
  }
  const live = cardsByStatus.EXTRACTED + cardsByStatus.NEEDS_REVIEW + cardsByStatus.CHEF_APPROVED;
  const [c] = counts;
  return {
    source: {
      ...toRow(source, live),
      rights: source.rights,
      metadata: source.metadataJson,
      attempt,
    },
    pages: {
      total: Number(c?.total ?? 0),
      withoutText: Number(c?.withoutText ?? 0),
      transcribed: Number(c?.transcribed ?? 0),
    },
    preview: preview.map((p) => ({
      pageNumber: p.pageNumber,
      text: p.text.slice(0, PAGE_PREVIEW_CHARS),
      truncated: p.text.length > PAGE_PREVIEW_CHARS,
      hasTextLayer: p.hasTextLayer,
    })),
    batches: batches.map((b) => ({
      batchIndex: b.batchIndex,
      pageStart: b.pageStart,
      pageEnd: b.pageEnd,
      mode: b.mode,
      status: b.status,
      cardsCreated: b.cardsCreated,
      error: b.error,
    })),
    cardsByStatus,
    unverifiedQuotes,
    hasFile: Boolean(source.fileKey) && source.processingStatus !== "PENDING_UPLOAD",
    isPdf: (source.originalFilename ?? "").toLowerCase().endsWith(".pdf"),
  };
}
