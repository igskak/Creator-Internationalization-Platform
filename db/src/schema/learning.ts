import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { PerformanceMemory, PerformanceStats } from "../json/learning";
import { actorType, appUsers, markets } from "./core";

// 0012_learning (plan 04 §0008_learning, 11 §11.5 and §11.6, M7-01). RLS on every table, no
// policies (04 §4.1). `master_ideas.performance_summary_id` and the experiment columns of
// `content_variants` are declared in content.ts.

export const EXPERIMENT_STATUSES = ["DRAFT", "RUNNING", "COMPLETED", "CANCELLED"] as const;
export const experimentStatus = pgEnum("experiment_status", EXPERIMENT_STATUSES);

const id = () => uuid().primaryKey().defaultRandom();
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/**
 * The "performance memory" of a market (or of all markets when `market_id` is null) over a window
 * [S§12.4]: what did better and worse at D7, overused themes, gaps, untested hypotheses, offers and
 * reviewer feedback. Ideas record the summary they were made with.
 */
export const performanceSummaries = pgTable(
  "performance_summaries",
  {
    id: id(),
    /** Null = across markets. */
    marketId: uuid().references(() => markets.id),
    windowStart: date({ mode: "string" }).notNull(),
    windowEnd: date({ mode: "string" }).notNull(),
    summaryJson: jsonb().$type<PerformanceMemory>().notNull(),
    statsJson: jsonb().$type<PerformanceStats>().notNull(),
    minSample: integer().notNull(),
    publicationsCount: integer().notNull(),
    createdByType: actorType().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("performance_summaries_market_idx").on(t.marketId, t.createdAt.desc())],
).enableRLS();

/** A two-arm comparison of one dimension in one market [S§5] (plan 11 §11.6). */
export const experiments = pgTable(
  "experiments",
  {
    id: id(),
    name: text().notNull(),
    hypothesis: text().notNull(),
    marketId: uuid().references(() => markets.id),
    /** One of EXPERIMENT_DIMENSIONS. */
    dimension: text().notNull(),
    variantA: text().notNull(),
    variantB: text().notNull(),
    primaryMetric: text().$type<"save_rate" | "share_rate">().notNull().default("save_rate"),
    minPostsPerArm: integer().notNull().default(5),
    status: experimentStatus().notNull().default("DRAFT"),
    startAt: timestamp({ withTimezone: true }),
    endAt: timestamp({ withTimezone: true }),
    notes: text(),
    /** The market visual hypothesis the result confirms or rejects, when the dimension is visual_style. */
    visualHypothesisId: text(),
    createdBy: uuid().references(() => appUsers.id),
    createdAt: createdAt(),
    /** Kept current by the set_updated_at() trigger. */
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("experiments_market_status_idx").on(t.marketId, t.status),
    check("experiments_metric_check", sql`${t.primaryMetric} in ('save_rate', 'share_rate')`),
    check("experiments_min_posts_check", sql`${t.minPostsPerArm} between 2 and 100`),
    check("experiments_arms_check", sql`${t.variantA} <> ${t.variantB}`),
  ],
).enableRLS();
