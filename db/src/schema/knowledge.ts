import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import type {
  CommonMistake,
  GenerationInputRefs,
  GenerationParams,
  GenerationUsage,
  Ingredient,
  KnowledgeGloss,
  KnowledgeSnapshot,
  PageLocator,
  PostAnnotations,
  PostMetrics,
  ProcedureStep,
  ProcessingError,
  ProcessingProgress,
  SourceReference,
  Temperature,
  Timing,
} from "../json/knowledge";
import type { RightsPolicy } from "../json/rights";
import { appUsers, brands } from "./core";

// 0002_knowledge (plan 04 §4.2, §4.3). RLS on every table, no policies (04 §4.1).

export const sourceType = pgEnum("source_type", [
  "BOOK",
  "GUIDE",
  "RECIPE",
  "INSTAGRAM_POST",
  "VIDEO",
  "TRANSCRIPT",
  "PHOTO",
  "NOTE",
  "PRODUCT_MATERIAL",
]);
export const rightsStatus = pgEnum("rights_status", [
  "UNKNOWN",
  "PENDING_REVIEW",
  "CLEARED",
  "RESTRICTED",
]);
export const processingStatus = pgEnum("processing_status", [
  "PENDING_UPLOAD",
  "UPLOADED",
  "QUEUED",
  "PROCESSING",
  "READY",
  "FAILED",
  "BLOCKED",
]);
export const knowledgeStatus = pgEnum("knowledge_status", [
  "EXTRACTED",
  "NEEDS_REVIEW",
  "CHEF_APPROVED",
  "ARCHIVED",
]);
/** EXTERNAL_RESEARCH is post-MVP [S§6.3]. */
export const knowledgeOrigin = pgEnum("knowledge_origin", [
  "SOURCE_EXTRACTED",
  "MANUAL",
  "EXTERNAL_RESEARCH",
]);
export const batchStatus = pgEnum("batch_status", [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "SKIPPED",
]);
export const generationStage = pgEnum("generation_stage", [
  "KNOWLEDGE_EXTRACTION",
  "IDEA_GENERATION",
  "MARKET_ADAPTATION",
  "CONTENT_WRITING",
  "CRITIC",
  "VISUAL_DIRECTION",
  "FIELD_REGENERATION",
  "POST_ANNOTATION",
  "KNOWLEDGE_GLOSS",
  "VISUAL_QA",
  "EVAL_JUDGE",
  "PAGE_TRANSCRIPTION",
]);
export const runStatus = pgEnum("run_status", [
  "SUCCEEDED",
  "REPAIRED",
  "INVALID_OUTPUT",
  "REFUSED",
  "FAILED",
]);

/** Content formats; only CAROUSEL is produced in the MVP. Reused by 0003_content. */
export const contentFormat = pgEnum("content_format", ["CAROUSEL", "REEL", "SINGLE_IMAGE"]);

export const EMBEDDING_DIMENSIONS = 1536;

const id = () => uuid().primaryKey().defaultRandom();
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
/** Kept current by the set_updated_at() trigger. */
const updatedAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

export const sourceAssets = pgTable(
  "source_assets",
  {
    id: id(),
    brandId: uuid()
      .notNull()
      .references(() => brands.id),
    type: sourceType().notNull(),
    title: text().notNull(),
    /** R2 object key (spec: file_url) [C-05]. */
    fileKey: text(),
    originalFilename: text(),
    mimeType: text(),
    fileSizeBytes: bigint({ mode: "number" }),
    checksumSha256: text(),
    /** ISO 639-1, usually 'ru'. */
    originalLanguage: text().notNull(),
    sourceAuthor: text(),
    rightsStatus: rightsStatus().notNull().default("UNKNOWN"),
    rights: jsonb().$type<RightsPolicy>().notNull(),
    processingStatus: processingStatus().notNull().default("PENDING_UPLOAD"),
    processingAttempt: integer().notNull().default(0),
    processingProgress: jsonb().$type<ProcessingProgress>().notNull().default(sql`'{}'::jsonb`),
    processingError: jsonb().$type<ProcessingError>(),
    pageCount: integer(),
    /** Edition, ISBN, chapter map, url … [S§5]. */
    metadataJson: jsonb().$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdBy: uuid().references(() => appUsers.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("source_assets_status_idx").on(t.processingStatus),
    uniqueIndex("source_assets_checksum_uq")
      .on(t.brandId, t.checksumSha256)
      .where(sql`${t.checksumSha256} is not null and ${t.archivedAt} is null`),
  ],
).enableRLS();

export const sourcePages = pgTable(
  "source_pages",
  {
    id: id(),
    sourceAssetId: uuid()
      .notNull()
      .references(() => sourceAssets.id, { onDelete: "cascade" }),
    /** 1-based; pseudo-page for non-paginated sources. */
    pageNumber: integer().notNull(),
    /** 'Ch. 3 › Dry brining' */
    sectionPath: text(),
    text: text().notNull().default(""),
    charCount: integer().notNull(),
    hasTextLayer: boolean().notNull().default(true),
    /** P1: text produced by vision transcription. */
    transcribed: boolean().notNull().default(false),
    locator: jsonb().$type<PageLocator>(),
    processingAttempt: integer().notNull(),
  },
  (t) => [unique("source_pages_asset_page_uq").on(t.sourceAssetId, t.pageNumber)],
).enableRLS();

/** P1: semantic search over raw sources. */
export const sourceChunks = pgTable(
  "source_chunks",
  {
    id: id(),
    sourceAssetId: uuid()
      .notNull()
      .references(() => sourceAssets.id, { onDelete: "cascade" }),
    chunkIndex: integer().notNull(),
    pageStart: integer(),
    pageEnd: integer(),
    sectionPath: text(),
    text: text().notNull(),
    tokenEstimate: integer().notNull(),
    language: text().notNull(),
    contentHash: text().notNull(),
    embedding: vector({ dimensions: EMBEDDING_DIMENSIONS }),
    embeddingModel: text(),
    processingAttempt: integer().notNull(),
  },
  (t) => [
    unique("source_chunks_asset_chunk_uq").on(t.sourceAssetId, t.chunkIndex),
    index("source_chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
).enableRLS();

/** Every model call [S§23 item 6]. master_idea_id and content_variant_id come with 0003. */
export const generationRuns = pgTable(
  "generation_runs",
  {
    id: id(),
    stage: generationStage().notNull(),
    promptId: text().notNull(),
    promptVersion: integer().notNull(),
    promptHash: text().notNull(),
    provider: text().notNull(),
    model: text().notNull(),
    params: jsonb().$type<GenerationParams>().notNull(),
    /** Rendered messages without binary documents. */
    request: jsonb().$type<unknown>(),
    inputRefs: jsonb().$type<GenerationInputRefs>().notNull().default(sql`'{}'::jsonb`),
    inputHash: text().notNull(),
    output: jsonb().$type<unknown>(),
    status: runStatus().notNull(),
    validationErrors: jsonb().$type<unknown>(),
    repairAttempts: integer().notNull().default(0),
    stopReason: text(),
    usage: jsonb().$type<GenerationUsage>(),
    costUsd: numeric({ precision: 10, scale: 4 }),
    latencyMs: integer(),
    error: jsonb().$type<ProcessingError>(),
    /** Repair / rewrite chains. */
    parentRunId: uuid().references((): AnyPgColumn => generationRuns.id),
    triggerRunId: text(),
    sourceAssetId: uuid().references(() => sourceAssets.id),
    /** FKs to master_ideas and content_variants are added in 0003 as custom SQL (no import cycle). */
    masterIdeaId: uuid(),
    contentVariantId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    index("generation_runs_stage_idx").on(t.stage, t.createdAt.desc()),
    index("generation_runs_variant_idx").on(t.contentVariantId),
  ],
).enableRLS();

export const knowledgeExtractionBatches = pgTable(
  "knowledge_extraction_batches",
  {
    id: id(),
    sourceAssetId: uuid()
      .notNull()
      .references(() => sourceAssets.id, { onDelete: "cascade" }),
    processingAttempt: integer().notNull(),
    batchIndex: integer().notNull(),
    pageStart: integer().notNull(),
    pageEnd: integer().notNull(),
    mode: text().$type<"PDF_NATIVE" | "TEXT">().notNull(),
    status: batchStatus().notNull().default("PENDING"),
    generationRunId: uuid().references(() => generationRuns.id),
    cardsCreated: integer().notNull().default(0),
    error: jsonb().$type<ProcessingError>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("knowledge_batches_attempt_index_uq").on(
      t.sourceAssetId,
      t.processingAttempt,
      t.batchIndex,
    ),
    check("knowledge_batches_mode_check", sql`${t.mode} in ('PDF_NATIVE', 'TEXT')`),
  ],
).enableRLS();

/** Knowledge Cards [S§6.3]. */
export const knowledgeItems = pgTable(
  "knowledge_items",
  {
    id: id(),
    brandId: uuid()
      .notNull()
      .references(() => brands.id),
    title: text().notNull(),
    /** Taxonomy codes. */
    category: text().notNull(),
    subcategory: text(),
    claim: text().notNull(),
    explanation: text().notNull().default(""),
    procedureJson: jsonb().$type<ProcedureStep[]>().notNull().default(sql`'[]'::jsonb`),
    ingredientsJson: jsonb().$type<Ingredient[]>().notNull().default(sql`'[]'::jsonb`),
    temperaturesJson: jsonb().$type<Temperature[]>().notNull().default(sql`'[]'::jsonb`),
    timingsJson: jsonb().$type<Timing[]>().notNull().default(sql`'[]'::jsonb`),
    commonMistakesJson: jsonb().$type<CommonMistake[]>().notNull().default(sql`'[]'::jsonb`),
    /** Null only for MANUAL cards without a source. */
    sourceAssetId: uuid().references(() => sourceAssets.id),
    sourceReference: jsonb().$type<SourceReference>(),
    /** Card language = source language (D-16). */
    language: text().notNull(),
    origin: knowledgeOrigin().notNull(),
    /** 0..1 from the extractor. */
    confidence: numeric({ precision: 3, scale: 2 }),
    reviewStatus: knowledgeStatus().notNull().default("EXTRACTED"),
    /** QUOTE_UNVERIFIED, LOW_CONFIDENCE, DUPLICATE_SUSPECTED, SAFETY_SENSITIVE. */
    reviewFlags: text().array().notNull().default(sql`'{}'::text[]`),
    safetySensitive: boolean().notNull().default(false),
    safetyNotes: text(),
    tags: text().array().notNull().default(sql`'{}'::text[]`),
    version: integer().notNull().default(1),
    approvedVersion: integer(),
    approvedBy: uuid().references(() => appUsers.id),
    approvedAt: timestamp({ withTimezone: true }),
    /** INACCURATE | DUPLICATE | OUT_OF_SCOPE | SUPERSEDED | OTHER */
    archiveReason: text(),
    duplicateOfId: uuid().references((): AnyPgColumn => knowledgeItems.id),
    extractionBatchId: uuid().references(() => knowledgeExtractionBatches.id),
    generationRunId: uuid().references(() => generationRuns.id),
    /** Idempotent inserts per batch. */
    ordinalInBatch: integer(),
    /** P1: not authoritative. */
    glossEn: jsonb().$type<KnowledgeGloss>(),
    embedding: vector({ dimensions: EMBEDDING_DIMENSIONS }),
    embeddingModel: text(),
    embeddingHash: text(),
    createdBy: uuid().references(() => appUsers.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("knowledge_items_batch_ordinal_uq").on(t.extractionBatchId, t.ordinalInBatch),
    index("knowledge_status_cat_idx").on(t.reviewStatus, t.category),
    index("knowledge_source_idx").on(t.sourceAssetId),
    index("knowledge_flags_idx").using("gin", t.reviewFlags),
    index("knowledge_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
).enableRLS();

export const knowledgeItemVersions = pgTable(
  "knowledge_item_versions",
  {
    id: id(),
    knowledgeItemId: uuid()
      .notNull()
      .references(() => knowledgeItems.id),
    version: integer().notNull(),
    /** All content fields at approval time. */
    snapshot: jsonb().$type<KnowledgeSnapshot>().notNull(),
    status: knowledgeStatus().notNull(),
    changedBy: uuid().references(() => appUsers.id),
    changeNote: text(),
    createdAt: createdAt(),
  },
  (t) => [unique("knowledge_versions_item_version_uq").on(t.knowledgeItemId, t.version)],
).enableRLS();

/** Seed dataset [S§20] (P1 features, table created now). */
export const historicalPosts = pgTable(
  "historical_posts",
  {
    id: id(),
    brandId: uuid()
      .notNull()
      .references(() => brands.id),
    /** The import file. */
    sourceAssetId: uuid().references(() => sourceAssets.id),
    platform: text().notNull().default("instagram"),
    accountHandle: text().notNull(),
    externalId: text().notNull(),
    permalink: text(),
    postedAt: timestamp({ withTimezone: true }),
    format: contentFormat(),
    caption: text(),
    mediaCount: integer(),
    language: text(),
    metrics: jsonb().$type<PostMetrics>().notNull().default(sql`'{}'::jsonb`),
    annotations: jsonb().$type<PostAnnotations>().notNull().default(sql`'{}'::jsonb`),
    annotationStatus: text()
      .$type<"NONE" | "AI_SUGGESTED" | "HUMAN_CONFIRMED">()
      .notNull()
      .default("NONE"),
    /** Good example of voice/format. */
    isExemplar: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("historical_posts_platform_external_uq").on(t.platform, t.externalId),
    check(
      "historical_posts_annotation_status_check",
      sql`${t.annotationStatus} in ('NONE', 'AI_SUGGESTED', 'HUMAN_CONFIRMED')`,
    ),
  ],
).enableRLS();
