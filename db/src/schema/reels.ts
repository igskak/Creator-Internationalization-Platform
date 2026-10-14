import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { contentVariants } from "./content";
import { brands } from "./core";
import { visualAssets } from "./creative";
import { generationRuns } from "./knowledge";

// 0009_reels (plan 18 §18.3). RLS on every table, no policies (04 §4.1). `reel_scripts` and
// `reel_renders` live in ./content next to `content_variants` (it references the render, which
// references the script and the variant, and the module rules forbid an import cycle), like
// `carousel_renders`.

const id = () => uuid().primaryKey().defaultRandom();
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
/** Kept current by the set_updated_at() trigger. */
const updatedAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/** PENDING: not sent yet. RUNNING: accepted by the vendor (has a request id). BLOCKED: moderation. */
export const reelShotStatus = pgEnum("reel_shot_status", [
  "PENDING",
  "RUNNING",
  "READY",
  "FAILED",
  "BLOCKED",
]);

/**
 * One generated shot. Shots are scoped to the brand and found again by `prompt_hash`, so the
 * Spanish Reel reuses the English shots (decision Q-10) and a rerun never pays twice;
 * `content_variant_id` is the variant that paid for it.
 */
export const reelShots = pgTable(
  "reel_shots",
  {
    id: id(),
    brandId: uuid()
      .notNull()
      .references(() => brands.id),
    /** The variant (Reel) that ordered the shot. */
    contentVariantId: uuid()
      .notNull()
      .references(() => contentVariants.id),
    /** Hash of model, resolution, seconds, prompt and the start frame's sha256. */
    promptHash: text().notNull(),
    status: reelShotStatus().notNull().default("PENDING"),
    provider: text().notNull(),
    model: text().notNull(),
    /** Set when the vendor accepted the shot; lets a crashed run wait again without paying. */
    providerRequestId: text(),
    prompt: text().notNull(),
    durationSeconds: integer().notNull(),
    resolution: text().notNull().default("720p"),
    /** The picture the shot starts from, and the sha256 of the prepared 9:16 frame. */
    sourceVisualAssetId: uuid().references(() => visualAssets.id),
    sourceFrameSha256: text(),
    /** The mp4 in R2; set when READY (the vendor keeps files only temporarily). */
    storageKey: text(),
    width: integer(),
    height: integer(),
    bytes: integer(),
    sha256: text(),
    /** List-price estimate (USD). */
    costUsd: numeric({ precision: 10, scale: 4 }),
    params: jsonb().$type<Record<string, unknown>>(),
    generationRunId: uuid().references(() => generationRuns.id),
    error: jsonb().$type<{ code: string; message: string; details?: Record<string, unknown> }>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One live shot per brand and prompt hash: a rerun, or another market, finds it.
    uniqueIndex("reel_shots_live_uq")
      .on(t.brandId, t.promptHash)
      .where(sql`${t.status} in ('PENDING', 'RUNNING', 'READY')`),
    index("reel_shots_variant_idx").on(t.contentVariantId),
    index("reel_shots_status_idx").on(t.status),
    check("reel_shots_ready_check", sql`${t.status} <> 'READY' or ${t.storageKey} is not null`),
    check(
      "reel_shots_running_check",
      sql`${t.status} <> 'RUNNING' or ${t.providerRequestId} is not null`,
    ),
    check("reel_shots_duration_check", sql`${t.durationSeconds} between 1 and 30`),
  ],
).enableRLS();
