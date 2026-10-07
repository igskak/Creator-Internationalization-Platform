import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  ContentLength,
  CriticReport,
  CtaSpec,
  DifferentiationReport,
  GenerationConfig,
  MarketBrief,
  PipelineState,
  Slide,
  UtmSpec,
  VisualBrief,
} from "../json/content";
import { appUsers, brands, markets } from "./core";
import { contentFormat, generationRuns, knowledgeItems, sourceAssets } from "./knowledge";

// 0003_content (plan 04 §4.3). RLS on every table, no policies (04 §4.1).
// content_format was created in 0002 (decision log, M1-01) and is reused here.
// generation_runs.master_idea_id and content_variant_id are declared next to the other
// generation_runs columns in ./knowledge; this migration adds them.

export const ideaStatus = pgEnum("idea_status", ["PROPOSED", "ACCEPTED", "REJECTED", "ARCHIVED"]);
export const commercialIntent = pgEnum("commercial_intent", [
  "NONE",
  "LEAD_MAGNET",
  "PRODUCT_SALE",
  "NURTURE",
]);
/** [S§7.4] + PUBLISHING, REJECTED [C-02]. */
export const variantStatus = pgEnum("variant_status", [
  "DRAFT",
  "GENERATING",
  "READY_FOR_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "SCHEDULED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
  "REJECTED",
]);
/** [S§7.2] */
export const criticVerdict = pgEnum("critic_verdict", [
  "PASS",
  "REQUEST_REWRITE",
  "FLAG_FOR_HUMAN",
]);

const id = () => uuid().primaryKey().defaultRandom();
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
/** Kept current by the set_updated_at() trigger. */
const updatedAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/** Original Reg.Chef catalog (spec: offers.source_product_id) [C-01]. */
export const products = pgTable(
  "products",
  {
    id: id(),
    brandId: uuid()
      .notNull()
      .references(() => brands.id),
    code: text().notNull().unique(),
    name: text().notNull(),
    type: text().$type<"GUIDE" | "RECIPE_COLLECTION" | "COURSE" | "BUNDLE" | "OTHER">().notNull(),
    description: text(),
    originalLanguage: text().notNull(),
    /** PRODUCT_MATERIAL source. */
    sourceAssetId: uuid().references(() => sourceAssets.id),
    status: text().$type<"ACTIVE" | "INACTIVE">().notNull().default("ACTIVE"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "products_type_check",
      sql`${t.type} in ('GUIDE', 'RECIPE_COLLECTION', 'COURSE', 'BUNDLE', 'OTHER')`,
    ),
    check("products_status_check", sql`${t.status} in ('ACTIVE', 'INACTIVE')`),
  ],
).enableRLS();

/** Localized, market-scoped [S§5, §13]. */
export const offers = pgTable(
  "offers",
  {
    id: id(),
    marketId: uuid()
      .notNull()
      .references(() => markets.id),
    /** Spec: source_product_id. */
    productId: uuid()
      .notNull()
      .references(() => products.id),
    name: text().notNull(),
    type: text().$type<"LEAD_MAGNET" | "PAID_PRODUCT" | "BUNDLE">().notNull(),
    price: numeric({ precision: 12, scale: 2 }),
    /** ISO 4217. */
    currency: char({ length: 3 }).notNull(),
    landingUrl: text(),
    /** Suggested ManyChat keyword. */
    defaultKeyword: text(),
    /** Offer priority for idea generation [S§7.2]. */
    priority: integer().notNull().default(0),
    status: text().$type<"DRAFT" | "ACTIVE" | "PAUSED" | "RETIRED">().notNull().default("DRAFT"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("offers_market_status_idx").on(t.marketId, t.status),
    check("offers_type_check", sql`${t.type} in ('LEAD_MAGNET', 'PAID_PRODUCT', 'BUNDLE')`),
    check("offers_status_check", sql`${t.status} in ('DRAFT', 'ACTIVE', 'PAUSED', 'RETIRED')`),
  ],
).enableRLS();

/** [S§7.1] performance_summary_id is added in 0008 (spec: created_from_metrics_window). */
export const masterIdeas = pgTable(
  "master_ideas",
  {
    id: id(),
    brandId: uuid()
      .notNull()
      .references(() => brands.id),
    topic: text().notNull(),
    /** Taxonomy codes for category and angle. */
    category: text().notNull(),
    angle: text().notNull(),
    /** English (D-16). */
    coreMessage: text().notNull(),
    evidenceSummary: text().notNull().default(""),
    recommendedFormat: contentFormat().notNull().default("CAROUSEL"),
    commercialIntent: commercialIntent().notNull().default("NONE"),
    /** Spec: offer_id; a market-neutral product instead [C-01]. */
    productId: uuid().references(() => products.id),
    status: ideaStatus().notNull().default("PROPOSED"),
    origin: text().$type<"AI_GENERATED" | "MANUAL">().notNull(),
    rationale: text(),
    rejectedReason: text(),
    generationRunId: uuid().references(() => generationRuns.id),
    createdBy: uuid().references(() => appUsers.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("master_ideas_status_idx").on(t.status, t.createdAt.desc()),
    check("master_ideas_origin_check", sql`${t.origin} in ('AI_GENERATED', 'MANUAL')`),
  ],
).enableRLS();

/** [S§5] Links an idea to the exact approved card versions it was built from. */
export const masterIdeaKnowledge = pgTable(
  "master_idea_knowledge",
  {
    masterIdeaId: uuid()
      .notNull()
      .references(() => masterIdeas.id),
    knowledgeItemId: uuid()
      .notNull()
      .references(() => knowledgeItems.id),
    /** Approved version used (lineage). */
    knowledgeVersion: integer().notNull(),
    role: text().$type<"PRIMARY" | "SUPPORTING">().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.masterIdeaId, t.knowledgeItemId] }),
    check("master_idea_knowledge_role_check", sql`${t.role} in ('PRIMARY', 'SUPPORTING')`),
  ],
).enableRLS();

/**
 * [S§5] current_render_id is added in 0004, approved_version_id in 0005,
 * experiment_id and experiment_arm in 0008.
 */
export const contentVariants = pgTable(
  "content_variants",
  {
    id: id(),
    masterIdeaId: uuid()
      .notNull()
      .references(() => masterIdeas.id),
    marketId: uuid()
      .notNull()
      .references(() => markets.id),
    format: contentFormat().notNull().default("CAROUSEL"),
    status: variantStatus().notNull().default("DRAFT"),
    hook: text(),
    /** Taxonomy hook_type code. */
    hookType: text(),
    caption: text(),
    /** Spec field: CTA text (kept, mirrors cta_json.text). */
    cta: text(),
    ctaType: text(),
    ctaJson: jsonb().$type<CtaSpec>(),
    hashtags: text().array().notNull().default(sql`'{}'::text[]`),
    slidesJson: jsonb().$type<Slide[]>().notNull().default(sql`'[]'::jsonb`),
    visualBriefJson: jsonb().$type<VisualBrief>(),
    /** Output of the market adapter. */
    marketBriefJson: jsonb().$type<MarketBrief>(),
    /** Taxonomy visual_style code. */
    visualStyle: text(),
    /** Derived; used by analytics and originality checks. */
    templateSequence: text().array().notNull().default(sql`'{}'::text[]`),
    /** Must belong to the same market (checked in code). */
    offerId: uuid().references(() => offers.id),
    campaignId: text().unique(),
    utmJson: jsonb().$type<UtmSpec>(),
    contentLength: jsonb().$type<ContentLength>(),
    /** Pipeline version, e.g. 'p1.0.0'. */
    generationVersion: text(),
    generationConfig: jsonb().$type<GenerationConfig>(),
    /** Resume after a crash. */
    pipelineState: jsonb().$type<PipelineState>(),
    qualityScore: numeric({ precision: 4, scale: 2 }),
    criticVerdict: criticVerdict(),
    criticReport: jsonb().$type<CriticReport>(),
    differentiationReport: jsonb().$type<DifferentiationReport>(),
    /** See VariantFlag in ../json/content. */
    flags: text().array().notNull().default(sql`'{}'::text[]`),
    /** Optimistic locking for concurrent reviewers. */
    lockVersion: integer().notNull().default(0),
    lastError: jsonb().$type<{
      code: string;
      message: string;
      details?: Record<string, unknown>;
    }>(),
    statusChangedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("content_variants_active_uq")
      .on(t.masterIdeaId, t.marketId, t.format)
      .where(sql`${t.status} <> 'REJECTED'`),
    index("content_variants_market_status_idx").on(t.marketId, t.status),
    index("content_variants_status_updated_idx").on(t.status, t.updatedAt.desc()),
  ],
).enableRLS();

/** P1 [S§20: Sergey's edits]. */
export const voiceExamples = pgTable(
  "voice_examples",
  {
    id: id(),
    /** Null = all markets. */
    marketId: uuid().references(() => markets.id),
    kind: text().$type<"EDIT_PAIR" | "EXEMPLAR" | "RULE">().notNull(),
    beforeText: text(),
    afterText: text(),
    note: text(),
    language: text(),
    source: text().$type<"SEED" | "REVIEW_EVENT">().notNull(),
    /** FK is added in 0005 when review_events exists. */
    reviewEventId: uuid(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("voice_examples_kind_check", sql`${t.kind} in ('EDIT_PAIR', 'EXEMPLAR', 'RULE')`),
    check("voice_examples_source_check", sql`${t.source} in ('SEED', 'REVIEW_EVENT')`),
  ],
).enableRLS();
