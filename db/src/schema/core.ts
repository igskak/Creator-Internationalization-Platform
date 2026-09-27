import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
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
import type {
  ForbiddenPattern,
  VisualHypothesis,
  VisualSystem,
  VocabularyEntry,
} from "../json/core";

// 0001_core (plan 04 §4.2, §4.3). Column names are snake_case via drizzle `casing`.
// RLS is enabled on every table without policies (04 §4.1): the Supabase REST API sees nothing.

export const userRole = pgEnum("user_role", ["owner", "editor", "chef"]);
export const actorType = pgEnum("actor_type", ["USER", "SYSTEM", "JOB"]);
export const measurementSystem = pgEnum("measurement_system", ["METRIC", "IMPERIAL", "DUAL"]);

export const TAXONOMY_KINDS = [
  "category",
  "subcategory",
  "angle",
  "hook_type",
  "cta_type",
  "visual_style",
  "reason_code",
] as const;
export type TaxonomyKind = (typeof TAXONOMY_KINDS)[number];

const id = () => uuid().primaryKey().defaultRandom();
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
/** Kept current by the set_updated_at() trigger. */
const updatedAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

export const appUsers = pgTable(
  "app_users",
  {
    id: id(),
    /** Supabase auth.users.id, linked on first login; no FK so tests stay portable. */
    authUserId: uuid().unique("app_users_auth_user_id_unique"),
    /** Stored lower-case. */
    email: text().notNull(),
    displayName: text(),
    role: userRole().notNull().default("editor"),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("app_users_email_uq").on(sql`lower(${t.email})`)],
).enableRLS();

export const brands = pgTable("brands", {
  id: id(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  description: text(),
  /** Markdown voice guide used in prompts. */
  brandVoice: text().notNull().default(""),
  visualSystem: jsonb()
    .$type<VisualSystem | Record<string, never>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();

export const markets = pgTable("markets", {
  id: id(),
  brandId: uuid()
    .notNull()
    .references(() => brands.id),
  /** 'es-ES' | 'en' | 'fr-FR' (spec: locale). */
  code: text().notNull().unique(),
  displayName: text().notNull(),
  flagEmoji: text(),
  /** ISO 3166-1 alpha-2 or 'GLOBAL'. */
  country: text().notNull(),
  /** ISO 639-1. */
  language: text().notNull(),
  currency: char({ length: 3 }).notNull(),
  /** IANA time zone, e.g. 'Europe/Madrid'. */
  timezone: text().notNull(),
  measurementSystem: measurementSystem().notNull(),
  foodCultureNotes: text().notNull().default(""),
  toneNotes: text().notNull().default(""),
  preferredVocabulary: jsonb().$type<VocabularyEntry[]>().notNull().default(sql`'[]'::jsonb`),
  forbiddenPatterns: jsonb().$type<ForbiddenPattern[]>().notNull().default(sql`'[]'::jsonb`),
  visualHypotheses: jsonb().$type<VisualHypothesis[]>().notNull().default(sql`'[]'::jsonb`),
  isActive: boolean().notNull().default(false),
  sortOrder: integer().notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();

export const taxonomyTerms = pgTable(
  "taxonomy_terms",
  {
    id: id(),
    kind: text().$type<TaxonomyKind>().notNull(),
    code: text().notNull(),
    label: text().notNull(),
    parentCode: text(),
    description: text(),
    isActive: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("taxonomy_terms_kind_code_uq").on(t.kind, t.code),
    check(
      "taxonomy_terms_kind_check",
      sql.raw(`kind in (${TAXONOMY_KINDS.map((k) => `'${k}'`).join(", ")})`),
    ),
  ],
).enableRLS();

/**
 * Keys: publishing.enabled (bool), publishing.min_gap_minutes (int), rights.defaults
 * (RightsDefaults), analytics.min_sample (int), ai.stage_overrides (P1), ai.monthly_budget_usd (P1).
 */
export const appSettings = pgTable("app_settings", {
  key: text().primaryKey(),
  value: jsonb().$type<unknown>().notNull(),
  updatedBy: uuid().references(() => appUsers.id),
  updatedAt: updatedAt(),
}).enableRLS();

export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    actorType: actorType().notNull(),
    actorUserId: uuid().references(() => appUsers.id),
    /** e.g. 'source.uploaded', 'variant.approved', 'publication.attempt'. */
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: uuid(),
    marketId: uuid().references(() => markets.id),
    /** Redacted details; never tokens. */
    data: jsonb().$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    requestId: text(),
    jobRunId: text(),
  },
  (t) => [
    index("audit_entity_idx").on(t.entityType, t.entityId, t.occurredAt.desc()),
    index("audit_action_idx").on(t.action, t.occurredAt.desc()),
  ],
).enableRLS();
