import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  pgView,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { ProfileActions, VideoMetrics } from "../json/analytics";
import { offers } from "./content";
import { appUsers, markets } from "./core";
import { publications, socialAccounts } from "./publishing";

// 0011_analytics (plan 04 §0007_analytics, 11 §11.2, M6-01). RLS on every table, no policies
// (04 §4.1). The views over these tables (v_publication_dimensions, v_publication_metrics_d7,
// v_campaign_attribution) are written by hand in the migration: Drizzle does not manage views.

/** When a snapshot was meant to be taken after publishing; MANUAL = on demand (11 §11.2). */
export const SNAPSHOT_SLOTS = ["H2", "D1", "D3", "D7", "D28", "MANUAL"] as const;
export const snapshotSlot = pgEnum("snapshot_slot", SNAPSHOT_SLOTS);
export const ATTRIBUTION_EVENT_TYPES = ["LEAD", "SALE", "REFUND"] as const;
export const attributionEventType = pgEnum("attribution_event_type", ATTRIBUTION_EVENT_TYPES);

const id = () => uuid().primaryKey().defaultRandom();
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/**
 * The metrics of one post at one moment [S§12.1]. A metric Instagram did not report is null, never
 * 0. `media_age_hours` is the real age when it was measured: a late slot keeps its true age and the
 * comparisons use the age, not only the slot name.
 */
export const metricSnapshots = pgTable(
  "metric_snapshots",
  {
    id: id(),
    publicationId: uuid()
      .notNull()
      .references(() => publications.id),
    snapshotSlot: snapshotSlot().notNull(),
    measuredAt: timestamp({ withTimezone: true }).notNull(),
    mediaAgeHours: numeric({ precision: 8, scale: 2 }).notNull(),
    reach: integer(),
    views: integer(),
    likes: integer(),
    comments: integer(),
    saves: integer(),
    shares: integer(),
    totalInteractions: integer(),
    profileActionsJson: jsonb().$type<ProfileActions>(),
    /** Follows attributed to the media, if Instagram reports them. */
    followerChange: integer(),
    /** Reels: watch-time metrics by Instagram's names. */
    videoMetricsJson: jsonb().$type<VideoMetrics>(),
    /** The answer as received (redacted of nothing sensitive: metrics only). */
    rawMetricsJson: jsonb().$type<Record<string, unknown>>().notNull(),
    apiVersion: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // One snapshot per slot and post; MANUAL ones may repeat.
    uniqueIndex("metric_snapshots_slot_uq")
      .on(t.publicationId, t.snapshotSlot)
      .where(sql`${t.snapshotSlot} <> 'MANUAL'`),
    index("metric_snapshots_publication_idx").on(t.publicationId, t.mediaAgeHours),
    check("metric_snapshots_age_check", sql`${t.mediaAgeHours} >= 0`),
  ],
).enableRLS();

/** Account-level growth metrics, one row per account and market-local day [C-03]. */
export const accountMetricSnapshots = pgTable(
  "account_metric_snapshots",
  {
    id: id(),
    socialAccountId: uuid()
      .notNull()
      .references(() => socialAccounts.id),
    /** The day in the market's time zone. */
    metricDate: date({ mode: "string" }).notNull(),
    measuredAt: timestamp({ withTimezone: true }).notNull(),
    followersCount: integer(),
    follows: integer(),
    unfollows: integer(),
    reach: integer(),
    reachFollowers: integer(),
    reachNonFollowers: integer(),
    views: integer(),
    accountsEngaged: integer(),
    totalInteractions: integer(),
    raw: jsonb().$type<Record<string, unknown>>().notNull(),
    apiVersion: text().notNull(),
  },
  (t) => [unique("account_metric_snapshots_day_uq").on(t.socialAccountId, t.metricDate)],
).enableRLS();

/** Leads, sales and refunds from the selling stack [S§13.1]; never customer personal data (A-10). */
export const attributionEvents = pgTable(
  "attribution_events",
  {
    id: id(),
    marketId: uuid()
      .notNull()
      .references(() => markets.id),
    type: attributionEventType().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    /** Matches `content_variants.campaign_id`; no foreign key: an import may hold unknown ids. */
    campaignId: text(),
    offerId: uuid().references(() => offers.id),
    quantity: integer().notNull().default(1),
    amount: numeric({ precision: 12, scale: 2 }),
    currency: text(),
    source: text().$type<"MANUAL" | "CSV_IMPORT" | "WEBHOOK">().notNull(),
    /** An order id or its hash. */
    externalRef: text(),
    utm: jsonb().$type<Record<string, string>>(),
    importBatchId: uuid(),
    notes: text(),
    createdBy: uuid().references(() => appUsers.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("attribution_events_source_ref_uq").on(t.source, t.externalRef),
    index("attribution_events_campaign_idx").on(t.campaignId),
    check(
      "attribution_events_source_check",
      sql`${t.source} in ('MANUAL', 'CSV_IMPORT', 'WEBHOOK')`,
    ),
    check("attribution_events_quantity_check", sql`${t.quantity} > 0`),
    check(
      "attribution_events_currency_check",
      sql`${t.currency} is null or ${t.currency} ~ '^[A-Z]{3}$'`,
    ),
  ],
).enableRLS();

// The views of 0011, declared as existing so that queries over them are typed and run the same on
// postgres.js and PGlite. Drizzle does not create them: the migration does.

/** One row per published, non-dry-run post with everything it can be grouped by (11 §11.3). */
export const vPublicationDimensions = pgView("v_publication_dimensions", {
  publicationId: uuid().notNull(),
  publishedAt: timestamp({ withTimezone: true }).notNull(),
  followerCountAtPublish: integer(),
  marketId: uuid().notNull(),
  marketCode: text().notNull(),
  weekdayLocal: integer().notNull(),
  daypartLocal: text().notNull(),
  masterIdeaId: uuid().notNull(),
  topic: text().notNull(),
  category: text().notNull(),
  angle: text().notNull(),
  commercialIntent: text().notNull(),
  productId: uuid(),
  variantId: uuid().notNull(),
  format: text().notNull(),
  hookType: text(),
  visualStyle: text(),
  ctaType: text(),
  offerId: uuid(),
  templateSequence: text().array().notNull(),
  firstTemplateId: text(),
  slideCount: integer(),
  captionChars: integer(),
  generationVersion: text(),
  campaignId: text(),
  /** 0012 (M7-01). */
  experimentId: uuid(),
  experimentArm: text(),
}).existing();

/** One row per post: the snapshot closest to 168 h among those at least 72 h old, with the rates. */
export const vPublicationMetricsD7 = pgView("v_publication_metrics_d7", {
  publicationId: uuid().notNull(),
  snapshotSlot: text().notNull(),
  mediaAgeHours: numeric({ precision: 8, scale: 2 }).notNull(),
  reach: integer(),
  views: integer(),
  likes: integer(),
  comments: integer(),
  saves: integer(),
  shares: integer(),
  totalInteractions: integer(),
  saveRate: numeric(),
  shareRate: numeric(),
  commentRate: numeric(),
  engagementRate: numeric(),
  isExactD7: boolean("is_exact_d7").notNull(),
}).existing();

/** Leads, sales and revenue of each campaign. */
export const vCampaignAttribution = pgView("v_campaign_attribution", {
  campaignId: text().notNull(),
  marketId: uuid().notNull(),
  offerId: uuid(),
  leads: integer().notNull(),
  sales: integer().notNull(),
  revenue: numeric().notNull(),
}).existing();
