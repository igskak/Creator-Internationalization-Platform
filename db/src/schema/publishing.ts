import { sql } from "drizzle-orm";
import {
  bigserial,
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
import type { AccountHealthSnapshot, InstagramError } from "../json/review";
import { contentVariants, contentVariantVersions } from "./content";
import { appUsers, markets } from "./core";

// 0006_review_scheduling (plan 04 §4.3), the account and publication half; review_events and
// content_variant_versions are in ./content. RLS on every table, no policies (04 §4.1).

export const publicationStatus = pgEnum("publication_status", [
  "SCHEDULED",
  "QUEUED",
  "IN_PROGRESS",
  "PUBLISHED",
  "FAILED",
  "CANCELLED",
  "DRY_RUN_PASSED",
]);
export const tokenStatus = pgEnum("token_status", ["VALID", "EXPIRING", "INVALID", "REVOKED"]);
export const socialAccountStatus = pgEnum("social_account_status", [
  "ACTIVE",
  "NEEDS_REAUTH",
  "DISABLED",
  "REVOKED",
]);

/** Publications that still hold the variant's single live slot (04 §4.3, [S§11.1]). */
export const LIVE_PUBLICATION_STATUSES = [
  "SCHEDULED",
  "QUEUED",
  "IN_PROGRESS",
  "PUBLISHED",
] as const;

const id = () => uuid().primaryKey().defaultRandom();
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
/** Kept current by the set_updated_at() trigger. */
const updatedAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/** One Instagram professional account per market [S§5]. */
export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: id(),
    marketId: uuid()
      .notNull()
      .references(() => markets.id),
    platform: text().notNull().default("instagram"),
    username: text().notNull(),
    /** Professional account id used in publish calls ⚠ V-03. */
    instagramAccountId: text().notNull(),
    appScopedUserId: text(),
    /** BUSINESS | MEDIA_CREATOR. */
    accountType: text(),
    /** 'enc:v1:…' (D-18). Never logged. */
    accessTokenEncrypted: text().notNull(),
    tokenExpiresAt: timestamp({ withTimezone: true }),
    tokenLastRefreshedAt: timestamp({ withTimezone: true }),
    tokenStatus: tokenStatus().notNull().default("VALID"),
    scopes: text().array().notNull().default(sql`'{}'::text[]`),
    status: socialAccountStatus().notNull().default("ACTIVE"),
    connectedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    connectedBy: uuid().references(() => appUsers.id),
    lastHealthCheckAt: timestamp({ withTimezone: true }),
    lastHealth: jsonb().$type<AccountHealthSnapshot>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("social_accounts_platform_account_uq").on(t.platform, t.instagramAccountId),
    uniqueIndex("social_accounts_one_active_uq")
      .on(t.marketId, t.platform)
      .where(sql`${t.status} = 'ACTIVE'`),
  ],
).enableRLS();

/** A planned or finished post of an approved version [S§5, §11]. */
export const publications = pgTable(
  "publications",
  {
    id: id(),
    contentVariantId: uuid()
      .notNull()
      .references(() => contentVariants.id),
    contentVariantVersionId: uuid()
      .notNull()
      .references(() => contentVariantVersions.id),
    marketId: uuid()
      .notNull()
      .references(() => markets.id),
    /** Resolved at dispatch time. */
    socialAccountId: uuid().references(() => socialAccounts.id),
    mode: text().$type<"IMMEDIATE" | "SCHEDULED">().notNull(),
    scheduledAt: timestamp({ withTimezone: true }),
    status: publicationStatus().notNull(),
    /** CREATE_CHILDREN | CREATE_PARENT | WAIT_READY | PUBLISH | FINALIZE. */
    step: text(),
    dryRun: boolean().notNull().default(false),
    /** 'pub:{publicationId}:{retryNo}'. */
    idempotencyKey: text().notNull().unique("publications_idempotency_key_unique"),
    retryNo: integer().notNull().default(0),
    attemptCount: integer().notNull().default(0),
    igChildrenContainerIds: text().array().notNull().default(sql`'{}'::text[]`),
    igContainerId: text(),
    igContainerStatus: text(),
    instagramMediaId: text().unique("publications_instagram_media_id_unique"),
    permalink: text(),
    publishedAt: timestamp({ withTimezone: true }),
    /** Posting context [S§12]. */
    followerCountAtPublish: integer(),
    lastError: jsonb().$type<InstagramError>(),
    triggerRunId: text(),
    createdBy: uuid().references(() => appUsers.id),
    cancelledBy: uuid().references(() => appUsers.id),
    cancelledAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // [S§11.1] no duplicates: one live, non-dry-run publication per variant.
    uniqueIndex("publications_one_live_per_variant_uq")
      .on(t.contentVariantId)
      .where(
        sql`${t.dryRun} = false and ${t.status} in ('SCHEDULED', 'QUEUED', 'IN_PROGRESS', 'PUBLISHED')`,
      ),
    index("publications_due_idx").on(t.status, t.scheduledAt),
    check("publications_mode_check", sql`${t.mode} in ('IMMEDIATE', 'SCHEDULED')`),
  ],
).enableRLS();

/**
 * One row per Graph API call of the publish machine [S§11.1]: the audit trail the idempotency
 * drill and the G2 checks read. `endpoint` is the path only; request and response are redacted
 * before they get here (0007_instagram_ops, plan 04 §4.3).
 */
export const publishAttempts = pgTable(
  "publish_attempts",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    publicationId: uuid()
      .notNull()
      .references(() => publications.id),
    attemptNo: integer().notNull(),
    step: text().notNull(),
    endpoint: text().notNull(),
    request: jsonb().$type<Record<string, unknown>>(),
    httpStatus: integer(),
    response: jsonb().$type<Record<string, unknown>>(),
    /** AMBIGUOUS: the call was sent and its result is unknown (a crash or a timeout). */
    outcome: text().$type<"OK" | "TRANSIENT_ERROR" | "PERMANENT_ERROR" | "AMBIGUOUS">().notNull(),
    errorCode: text(),
    errorSubcode: text(),
    fbtraceId: text(),
    durationMs: integer(),
    triggerRunId: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index("publish_attempts_pub_idx").on(t.publicationId, t.createdAt),
    check(
      "publish_attempts_outcome_check",
      sql`${t.outcome} in ('OK', 'TRANSIENT_ERROR', 'PERMANENT_ERROR', 'AMBIGUOUS')`,
    ),
  ],
).enableRLS();

/** External API errors and health findings, shown on the Health page (0007_instagram_ops). */
export const integrationEvents = pgTable(
  "integration_events",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    /** instagram | anthropic | openai | r2 | trigger. */
    integration: text().notNull(),
    socialAccountId: uuid().references(() => socialAccounts.id),
    severity: text().$type<"INFO" | "WARN" | "ERROR">().notNull(),
    code: text().notNull(),
    message: text().notNull(),
    details: jsonb().$type<Record<string, unknown>>(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("integration_events_open_idx")
      .on(t.integration, t.occurredAt.desc())
      .where(sql`${t.resolvedAt} is null`),
    check("integration_events_severity_check", sql`${t.severity} in ('INFO', 'WARN', 'ERROR')`),
  ],
).enableRLS();
