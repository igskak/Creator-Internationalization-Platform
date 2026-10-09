import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { RightsPolicy } from "../json/rights";
import type { QaReport } from "../json/content";
import { contentVariants } from "./content";
import { brands } from "./core";
import { generationRuns, sourceAssets } from "./knowledge";

// 0004_creative (plan 04 §4.3). RLS on every table, no policies (04 §4.1).
// content_variants.current_render_id is declared next to the other content_variants columns in
// ./content; this migration adds it. The two files import each other, but only inside lazy
// reference callbacks, so the module cycle is harmless.

export const assetStatus = pgEnum("asset_status", ["PENDING", "READY", "FAILED", "REJECTED"]);
export const renderStatus = pgEnum("render_status", ["PENDING", "RENDERING", "READY", "FAILED"]);

const id = () => uuid().primaryKey().defaultRandom();
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
/** Kept current by the set_updated_at() trigger. */
const updatedAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

export const VISUAL_ASSET_KINDS = ["GENERATED", "LIBRARY_PHOTO", "UPLOADED"] as const;

/** Generated, library and uploaded images [S§6, §8]. */
export const visualAssets = pgTable(
  "visual_assets",
  {
    id: id(),
    brandId: uuid()
      .notNull()
      .references(() => brands.id),
    kind: text().$type<(typeof VISUAL_ASSET_KINDS)[number]>().notNull(),
    status: assetStatus().notNull().default("PENDING"),
    /** LIBRARY_PHOTO origin. */
    sourceAssetId: uuid().references(() => sourceAssets.id),
    contentVariantId: uuid().references(() => contentVariants.id),
    slideId: text(),
    slot: text(),
    provider: text(),
    model: text(),
    prompt: text(),
    negativePrompt: text(),
    promptHash: text(),
    seed: text(),
    params: jsonb().$type<Record<string, unknown>>(),
    generationRunId: uuid().references(() => generationRuns.id),
    storageKey: text(),
    /** The unprocessed provider output (kept next to the normalized image). */
    originalKey: text(),
    mimeType: text(),
    width: integer(),
    height: integer(),
    bytes: integer(),
    /** Perceptual hash (duplication checks). */
    phash: text(),
    isAiGenerated: boolean().notNull().default(false),
    description: text(),
    tags: text().array().notNull().default(sql`'{}'::text[]`),
    rights: jsonb().$type<RightsPolicy>(),
    error: jsonb().$type<{ code: string; message: string; details?: Record<string, unknown> }>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One live generation per slot and prompt: a rerun finds it instead of paying again.
    uniqueIndex("visual_assets_gen_uq")
      .on(t.contentVariantId, t.slideId, t.slot, t.promptHash)
      .where(sql`${t.kind} = 'GENERATED' and ${t.status} in ('PENDING', 'READY')`),
    index("visual_assets_kind_status_idx").on(t.kind, t.status),
    check("visual_assets_kind_check", sql`${t.kind} in ('GENERATED', 'LIBRARY_PHOTO', 'UPLOADED')`),
  ],
).enableRLS();

/** One render of a variant's slides; the input hash makes a re-render of the same input a no-op. */
export const carouselRenders = pgTable(
  "carousel_renders",
  {
    id: id(),
    contentVariantId: uuid()
      .notNull()
      .references(() => contentVariants.id),
    /** Hash of slides, asset ids, theme and template versions. */
    inputHash: text().notNull(),
    status: renderStatus().notNull().default("PENDING"),
    width: integer().notNull().default(1080),
    height: integer().notNull().default(1350),
    slideCount: integer(),
    templatesVersion: text().notNull(),
    qaReport: jsonb().$type<QaReport>(),
    error: jsonb().$type<{ code: string; message: string; details?: Record<string, unknown> }>(),
    triggerRunId: text(),
    createdAt: createdAt(),
    completedAt: timestamp({ withTimezone: true }),
  },
  (t) => [unique("carousel_renders_variant_input_uq").on(t.contentVariantId, t.inputHash)],
).enableRLS();

export const renderedSlides = pgTable(
  "rendered_slides",
  {
    id: id(),
    carouselRenderId: uuid()
      .notNull()
      .references(() => carouselRenders.id, { onDelete: "cascade" }),
    slideIndex: integer().notNull(),
    slideId: text().notNull(),
    templateId: text().notNull(),
    storageKey: text().notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    bytes: integer().notNull(),
    sha256: text().notNull(),
  },
  (t) => [unique("rendered_slides_render_index_uq").on(t.carouselRenderId, t.slideIndex)],
).enableRLS();
