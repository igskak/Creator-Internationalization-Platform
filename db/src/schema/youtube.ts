import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { YouTubeError, YouTubeMetadata } from "../json/youtube";
import { contentVariants, contentVariantVersions } from "./content";
import { appUsers, markets } from "./core";
import { publications } from "./publishing";

// 0014_youtube_shorts (task G-09, docs/design/youtube-shorts.md): a published Reel uploaded to the
// market's YouTube channel as a Short. RLS on, no policies (04 §4.1).

export const youtubeUploadStatus = pgEnum("youtube_upload_status", [
  "QUEUED",
  "IN_PROGRESS",
  "PUBLISHED",
  "DRY_RUN_PASSED",
  "FAILED",
]);

/** Uploads that hold the variant's single live slot on YouTube. */
export const LIVE_YOUTUBE_UPLOAD_STATUSES = ["QUEUED", "IN_PROGRESS", "PUBLISHED"] as const;

/** One attempt to put one approved Reel on YouTube, after its Instagram publication went out. */
export const youtubeUploads = pgTable(
  "youtube_uploads",
  {
    id: uuid().primaryKey().defaultRandom(),
    contentVariantId: uuid()
      .notNull()
      .references(() => contentVariants.id),
    /** The approved snapshot Instagram published; the video and the text come from it. */
    contentVariantVersionId: uuid()
      .notNull()
      .references(() => contentVariantVersions.id),
    /** The Instagram publication this upload follows. */
    publicationId: uuid()
      .notNull()
      .references(() => publications.id),
    marketId: uuid()
      .notNull()
      .references(() => markets.id),
    status: youtubeUploadStatus().notNull().default("QUEUED"),
    /** GUARDS | UPLOAD | FINALIZE. */
    step: text().notNull().default("GUARDS"),
    dryRun: boolean().notNull().default(false),
    attemptCount: integer().notNull().default(0),
    triggerRunId: text(),
    /** The channel the token belonged to when the guards passed. */
    channelId: text(),
    metadata: jsonb().$type<YouTubeMetadata>(),
    /** The resumable session URI, 'enc:v1:…' (D-18): it accepts bytes without a token. */
    uploadSessionEncrypted: text(),
    /** Set right before the bytes are sent: from then on a lost answer is ambiguous. */
    uploadStartedAt: timestamp({ withTimezone: true }),
    youtubeVideoId: text().unique("youtube_uploads_video_id_unique"),
    url: text(),
    /** YouTube's `status.uploadStatus` and `processingDetails.processingStatus`, last read. */
    uploadStatus: text(),
    processingStatus: text(),
    publishedAt: timestamp({ withTimezone: true }),
    lastError: jsonb().$type<YouTubeError>(),
    createdBy: uuid().references(() => appUsers.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Kept current by the set_updated_at() trigger. */
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Never two videos of one Reel: one live, non-dry-run upload per variant.
    uniqueIndex("youtube_uploads_one_live_per_variant_uq")
      .on(t.contentVariantId)
      .where(sql`${t.dryRun} = false and ${t.status} in ('QUEUED', 'IN_PROGRESS', 'PUBLISHED')`),
    index("youtube_uploads_publication_idx").on(t.publicationId),
    index("youtube_uploads_status_idx").on(t.status, t.createdAt),
  ],
).enableRLS();
