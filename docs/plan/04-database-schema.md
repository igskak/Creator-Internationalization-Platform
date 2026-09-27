# 04 · Database schema

Spec §23.1 item 4 (§23 item 3). The schema keeps every table and field from [S§5] and adds what the spec needs elsewhere (audit, renders, approved snapshots, attribution, account metrics). Every addition or change is listed in §4.8.

Key requirement [S§5]: answer *"Which source knowledge, master idea, market adaptation, hook, visual style, CTA and offer produced this result?"* — see the lineage query in §4.6.

## 4.1 Conventions
- Primary key: `id uuid primary key default gen_random_uuid()` unless noted. `audit_events` uses a bigint identity.
- Timestamps: `created_at timestamptz not null default now()`; `updated_at timestamptz not null default now()` kept by trigger `set_updated_at()`. All times are stored in UTC.
- Statuses: Postgres enums (state machines, D-22). Evolving vocabularies: `text` columns validated against `taxonomy_terms` in app code.
- JSON: `jsonb`, typed with Zod schemas in `db/src/json/*.ts`, validated on every write (§4.4).
- Foreign keys: `on delete restrict` for the lineage chain (source → knowledge → idea → variant → version → publication → metrics). `on delete cascade` only for pure children (pages, chunks, batches, rendered slides).
- No hard deletes of lineage rows. Use `status = ARCHIVED` or `archived_at`.
- RLS: `alter table … enable row level security` on every table, no policies. The Supabase REST API (anon / authenticated keys) can read nothing. The app connects with the database owner role (D-03).
- Money: `numeric(12,2)` + `currency char(3)` (ISO 4217). Rates are computed in queries, never stored.
- Vectors: `vector(1536)` (D-09). Index: HNSW with `vector_cosine_ops`.
- Below, `pk` = `id uuid primary key default gen_random_uuid()`, `ts` = `created_at` + `updated_at`.

## 4.2 Enums

```sql
-- 0001_core
create type user_role              as enum ('owner','editor','chef');
create type actor_type             as enum ('USER','SYSTEM','JOB');
create type measurement_system     as enum ('METRIC','IMPERIAL','DUAL');
-- 0002_knowledge
create type source_type            as enum ('BOOK','GUIDE','RECIPE','INSTAGRAM_POST','VIDEO','TRANSCRIPT','PHOTO','NOTE','PRODUCT_MATERIAL');  -- [S§6.1]
create type rights_status          as enum ('UNKNOWN','PENDING_REVIEW','CLEARED','RESTRICTED');
create type processing_status      as enum ('PENDING_UPLOAD','UPLOADED','QUEUED','PROCESSING','READY','FAILED','BLOCKED');
create type knowledge_status       as enum ('EXTRACTED','NEEDS_REVIEW','CHEF_APPROVED','ARCHIVED');  -- [S§6.4]
create type knowledge_origin       as enum ('SOURCE_EXTRACTED','MANUAL','EXTERNAL_RESEARCH');       -- EXTERNAL_RESEARCH is post-MVP [S§6.3]
create type batch_status           as enum ('PENDING','RUNNING','SUCCEEDED','FAILED','SKIPPED');
create type generation_stage       as enum ('KNOWLEDGE_EXTRACTION','IDEA_GENERATION','MARKET_ADAPTATION','CONTENT_WRITING',
                                            'CRITIC','VISUAL_DIRECTION','FIELD_REGENERATION','POST_ANNOTATION',
                                            'KNOWLEDGE_GLOSS','VISUAL_QA','EVAL_JUDGE','PAGE_TRANSCRIPTION');
create type run_status             as enum ('SUCCEEDED','REPAIRED','INVALID_OUTPUT','REFUSED','FAILED');
-- 0003_content
create type idea_status            as enum ('PROPOSED','ACCEPTED','REJECTED','ARCHIVED');
create type content_format         as enum ('CAROUSEL','REEL','SINGLE_IMAGE');   -- only CAROUSEL is produced in MVP
create type commercial_intent      as enum ('NONE','LEAD_MAGNET','PRODUCT_SALE','NURTURE');
create type variant_status         as enum ('DRAFT','GENERATING','READY_FOR_REVIEW','CHANGES_REQUESTED','APPROVED',
                                            'SCHEDULED','PUBLISHING','PUBLISHED','FAILED','REJECTED');  -- [S§7.4] + PUBLISHING, REJECTED [C-02]
create type critic_verdict         as enum ('PASS','REQUEST_REWRITE','FLAG_FOR_HUMAN');  -- [S§7.2]
-- 0004_creative
create type asset_status           as enum ('PENDING','READY','FAILED','REJECTED');
create type render_status          as enum ('PENDING','RENDERING','READY','FAILED');
-- 0005_review_scheduling
create type review_action          as enum ('EDIT','REGENERATE','APPROVE','REJECT','REQUEST_CHANGES','RESUBMIT','UNAPPROVE','COMMENT');
create type publication_status     as enum ('SCHEDULED','QUEUED','IN_PROGRESS','PUBLISHED','FAILED','CANCELLED','DRY_RUN_PASSED');
create type token_status           as enum ('VALID','EXPIRING','INVALID','REVOKED');
create type social_account_status  as enum ('ACTIVE','NEEDS_REAUTH','DISABLED','REVOKED');
-- 0007_analytics
create type snapshot_slot          as enum ('H2','D1','D3','D7','D28','MANUAL');
create type attribution_event_type as enum ('LEAD','SALE','REFUND');
-- 0008_learning
create type experiment_status      as enum ('DRAFT','RUNNING','COMPLETED','CANCELLED');
```

## 4.3 Tables by migration

### 0000_extensions (M0-09)
```sql
create extension if not exists vector;   -- Supabase: schema "extensions" (on search_path) ⚠ V-20
```
`gen_random_uuid()` is built into Postgres 13+. No other extension is required (keeps PGlite compatible).

### 0001_core (M0-10)
```sql
create table app_users (
  pk,
  auth_user_id  uuid unique,                    -- Supabase auth.users.id; linked on first login (no FK: keeps tests portable)
  email         text not null,                  -- stored lower-case
  display_name  text,
  role          user_role not null default 'editor',
  is_active     boolean not null default true,
  ts
);
create unique index app_users_email_uq on app_users (lower(email));

create table brands (
  pk, slug text not null unique, name text not null, description text,
  brand_voice   text  not null default '',      -- Markdown voice guide used in prompts [S§5]
  visual_system jsonb not null default '{}',    -- VisualSystem (§4.4) [S§5, §8.2]
  ts
);

create table markets (
  pk, brand_id uuid not null references brands,
  code          text not null unique,           -- 'es-ES' | 'en' | 'fr-FR'   (spec: locale)
  display_name  text not null, flag_emoji text,
  country       text not null,                  -- ISO 3166-1 alpha-2 or 'GLOBAL'
  language      text not null,                  -- ISO 639-1
  currency      char(3) not null,
  timezone      text not null,                  -- IANA, e.g. 'Europe/Madrid'
  measurement_system measurement_system not null,
  food_culture_notes text not null default '',
  tone_notes         text not null default '',
  preferred_vocabulary jsonb not null default '[]',   -- VocabularyEntry[]
  forbidden_patterns   jsonb not null default '[]',   -- ForbiddenPattern[]
  visual_hypotheses    jsonb not null default '[]',   -- VisualHypothesis[] [S§8.2]
  is_active     boolean not null default false,
  sort_order    int not null default 0,
  ts
);

create table taxonomy_terms (
  pk,
  kind   text not null check (kind in ('category','subcategory','angle','hook_type','cta_type','visual_style','reason_code')),
  code   text not null, label text not null, parent_code text, description text,
  is_active boolean not null default true, sort_order int not null default 0,
  ts, unique (kind, code)
);

create table app_settings (
  key text primary key, value jsonb not null,
  updated_by uuid references app_users, updated_at timestamptz not null default now()
);
-- keys: publishing.enabled (bool), publishing.min_gap_minutes (int), rights.defaults (RightsDefaults),
--       analytics.min_sample (int), ai.stage_overrides (P1), ai.monthly_budget_usd (P1)

create table audit_events (
  id bigint generated always as identity primary key,
  occurred_at   timestamptz not null default now(),
  actor_type    actor_type not null,
  actor_user_id uuid references app_users,
  action        text not null,                  -- 'source.uploaded', 'knowledge.approved', 'variant.approved',
                                                --  'publication.scheduled', 'publication.attempt', 'instagram.connected', …
  entity_type   text not null, entity_id uuid,
  market_id     uuid references markets,
  data          jsonb not null default '{}',    -- redacted details; never tokens
  request_id    text, job_run_id text
);
create index audit_entity_idx on audit_events (entity_type, entity_id, occurred_at desc);
create index audit_action_idx on audit_events (action, occurred_at desc);
```

### 0002_knowledge (M1-01)
```sql
create table source_assets (
  pk, brand_id uuid not null references brands,
  type               source_type not null,
  title              text not null,
  file_key           text,                       -- R2 object key (spec: file_url) [C-05]
  original_filename  text, mime_type text, file_size_bytes bigint, checksum_sha256 text,
  original_language  text not null,              -- ISO 639-1, usually 'ru'
  source_author      text,
  rights_status      rights_status not null default 'UNKNOWN',
  rights             jsonb not null,             -- RightsPolicy [S§6.2]
  processing_status  processing_status not null default 'PENDING_UPLOAD',
  processing_attempt int not null default 0,
  processing_progress jsonb not null default '{}',  -- {stage, pagesTotal, batchesTotal, batchesDone, cardsCreated}
  processing_error   jsonb,                      -- {code, message, details}
  page_count         int,
  metadata_json      jsonb not null default '{}',   -- [S§5] edition, ISBN, chapter map, url …
  created_by uuid references app_users, ts, archived_at timestamptz
);
create index source_assets_status_idx on source_assets (processing_status);
create unique index source_assets_checksum_uq on source_assets (brand_id, checksum_sha256)
  where checksum_sha256 is not null and archived_at is null;

create table source_pages (
  pk, source_asset_id uuid not null references source_assets on delete cascade,
  page_number    int not null,                   -- 1-based; pseudo-page for non-paginated sources
  section_path   text,                           -- 'Ch. 3 › Dry brining'
  text           text not null default '',
  char_count     int not null,
  has_text_layer boolean not null default true,
  transcribed    boolean not null default false, -- P1: text produced by vision transcription
  locator        jsonb,                          -- transcripts {startMs,endMs}; posts {externalId}
  processing_attempt int not null,
  unique (source_asset_id, page_number)
);

create table source_chunks (                     -- P1 (semantic search over raw sources)
  pk, source_asset_id uuid not null references source_assets on delete cascade,
  chunk_index int not null, page_start int, page_end int, section_path text,
  text text not null, token_estimate int not null, language text not null, content_hash text not null,
  embedding vector(1536), embedding_model text,
  processing_attempt int not null,
  unique (source_asset_id, chunk_index)
);
create index source_chunks_embedding_idx on source_chunks using hnsw (embedding vector_cosine_ops);

create table generation_runs (                   -- every model call [S§23 item 6: versioning]
  pk,
  stage          generation_stage not null,
  prompt_id      text not null, prompt_version int not null, prompt_hash text not null,
  provider       text not null, model text not null,
  params         jsonb not null,                 -- {effort, maxTokens, thinking, stream}
  request        jsonb,                          -- rendered messages without binary documents
  input_refs     jsonb not null default '{}',    -- {sourceAssetId, pageRange, masterIdeaId, variantId, knowledgeItemIds[]}
  input_hash     text not null,
  output         jsonb,
  status         run_status not null,
  validation_errors jsonb, repair_attempts int not null default 0,
  stop_reason    text,
  usage          jsonb,                          -- {inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens}
  cost_usd       numeric(10,4),
  latency_ms     int,
  error          jsonb,
  parent_run_id  uuid references generation_runs,   -- repair / rewrite chains
  trigger_run_id text,
  source_asset_id uuid references source_assets,
  created_at     timestamptz not null default now()
  -- master_idea_id, content_variant_id added in 0003 (nullable FKs)
);
create index generation_runs_stage_idx on generation_runs (stage, created_at desc);

create table knowledge_extraction_batches (
  pk, source_asset_id uuid not null references source_assets on delete cascade,
  processing_attempt int not null, batch_index int not null,
  page_start int not null, page_end int not null,
  mode    text not null check (mode in ('PDF_NATIVE','TEXT')),
  status  batch_status not null default 'PENDING',
  generation_run_id uuid references generation_runs,
  cards_created int not null default 0, error jsonb, ts,
  unique (source_asset_id, processing_attempt, batch_index)
);

create table knowledge_items (                   -- Knowledge Cards [S§6.3]
  pk, brand_id uuid not null references brands,
  title          text not null,
  category       text not null, subcategory text,          -- taxonomy codes
  claim          text not null,
  explanation    text not null default '',
  procedure_json       jsonb not null default '[]',        -- ProcedureStep[]
  ingredients_json     jsonb not null default '[]',        -- Ingredient[]
  temperatures_json    jsonb not null default '[]',        -- Temperature[]
  timings_json         jsonb not null default '[]',        -- Timing[]
  common_mistakes_json jsonb not null default '[]',        -- CommonMistake[]
  source_asset_id  uuid references source_assets,          -- null only for MANUAL cards without a source
  source_reference jsonb,                                  -- SourceReference [C-06]
  language       text not null,                            -- card language = source language (D-16)
  origin         knowledge_origin not null,
  confidence     numeric(3,2),                             -- 0..1 from the extractor
  review_status  knowledge_status not null default 'EXTRACTED',
  review_flags   text[] not null default '{}',             -- QUOTE_UNVERIFIED, LOW_CONFIDENCE, DUPLICATE_SUSPECTED, SAFETY_SENSITIVE
  safety_sensitive boolean not null default false, safety_notes text,
  tags           text[] not null default '{}',
  version        int not null default 1,
  approved_version int, approved_by uuid references app_users, approved_at timestamptz,
  archive_reason text,                                     -- INACCURATE | DUPLICATE | OUT_OF_SCOPE | SUPERSEDED | OTHER
  duplicate_of_id uuid references knowledge_items,
  extraction_batch_id uuid references knowledge_extraction_batches,
  generation_run_id   uuid references generation_runs,
  ordinal_in_batch    int,                                 -- idempotent inserts per batch
  gloss_en       jsonb,                                    -- P1: {title, claim, explanation, model, createdAt}; not authoritative
  embedding      vector(1536), embedding_model text, embedding_hash text,
  created_by uuid references app_users, ts,
  unique (extraction_batch_id, ordinal_in_batch)
);
create index knowledge_status_cat_idx on knowledge_items (review_status, category);
create index knowledge_source_idx     on knowledge_items (source_asset_id);
create index knowledge_flags_idx      on knowledge_items using gin (review_flags);
create index knowledge_embedding_idx  on knowledge_items using hnsw (embedding vector_cosine_ops);

create table knowledge_item_versions (
  pk, knowledge_item_id uuid not null references knowledge_items,
  version     int not null,
  snapshot    jsonb not null,                    -- all content fields at approval time
  status      knowledge_status not null,
  changed_by  uuid references app_users, change_note text,
  created_at  timestamptz not null default now(),
  unique (knowledge_item_id, version)
);

create table historical_posts (                  -- seed dataset [S§20] (P1 features, table created now)
  pk, brand_id uuid not null references brands,
  source_asset_id uuid references source_assets, -- the import file
  platform text not null default 'instagram', account_handle text not null,
  external_id text not null, permalink text, posted_at timestamptz,
  format content_format, caption text, media_count int, language text,
  metrics      jsonb not null default '{}',      -- {likes, comments, saves, shares, reach, views, collectedAt}
  annotations  jsonb not null default '{}',      -- {category, angle, hookType, ctaType, productCode, visualPattern}
  annotation_status text not null default 'NONE' check (annotation_status in ('NONE','AI_SUGGESTED','HUMAN_CONFIRMED')),
  is_exemplar  boolean not null default false,   -- good example of voice/format
  ts, unique (platform, external_id)
);
```

### 0003_content (M2-01)
```sql
create table products (                          -- original Reg.Chef catalog (spec: offers.source_product_id) [C-01]
  pk, brand_id uuid not null references brands,
  code text not null unique, name text not null,
  type text not null check (type in ('GUIDE','RECIPE_COLLECTION','COURSE','BUNDLE','OTHER')),
  description text, original_language text not null,
  source_asset_id uuid references source_assets,  -- PRODUCT_MATERIAL
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  ts
);

create table offers (                            -- localized, market-scoped [S§5, §13]
  pk, market_id uuid not null references markets,
  product_id uuid not null references products,  -- spec: source_product_id
  name text not null,
  type text not null check (type in ('LEAD_MAGNET','PAID_PRODUCT','BUNDLE')),
  price numeric(12,2), currency char(3) not null,
  landing_url text,
  default_keyword text,                          -- suggested ManyChat keyword
  priority int not null default 0,               -- offer priority for idea generation [S§7.2]
  status text not null default 'DRAFT' check (status in ('DRAFT','ACTIVE','PAUSED','RETIRED')),
  ts
);
create index offers_market_status_idx on offers (market_id, status);

create table master_ideas (                      -- [S§7.1]
  pk, brand_id uuid not null references brands,
  topic text not null, category text not null, angle text not null,   -- taxonomy codes for category/angle
  core_message text not null,                    -- English (D-16)
  evidence_summary text not null default '',
  recommended_format content_format not null default 'CAROUSEL',
  commercial_intent  commercial_intent not null default 'NONE',
  product_id uuid references products,           -- spec: offer_id (market-neutral product instead) [C-01]
  status idea_status not null default 'PROPOSED',
  origin text not null check (origin in ('AI_GENERATED','MANUAL')),
  rationale text, rejected_reason text,
  generation_run_id uuid references generation_runs,
  created_by uuid references app_users, ts
  -- performance_summary_id added in 0008 (spec: created_from_metrics_window)
);
create index master_ideas_status_idx on master_ideas (status, created_at desc);

create table master_idea_knowledge (             -- [S§5]
  master_idea_id    uuid not null references master_ideas,
  knowledge_item_id uuid not null references knowledge_items,
  knowledge_version int not null,                -- approved version used (lineage)
  role text not null check (role in ('PRIMARY','SUPPORTING')),
  primary key (master_idea_id, knowledge_item_id)
);

create table content_variants (                  -- [S§5]
  pk,
  master_idea_id uuid not null references master_ideas,
  market_id      uuid not null references markets,
  format         content_format not null default 'CAROUSEL',
  status         variant_status not null default 'DRAFT',
  hook text, hook_type text,                     -- hook_type: taxonomy
  caption text,
  cta text,                                      -- spec field: CTA text (kept, mirrors cta_json.text)
  cta_type text, cta_json jsonb,                 -- CtaSpec
  hashtags text[] not null default '{}',
  slides_json        jsonb not null default '[]',   -- Slide[]
  visual_brief_json  jsonb,                          -- VisualBrief
  market_brief_json  jsonb,                          -- MarketBrief (output of the market adapter)
  visual_style text,                              -- taxonomy
  template_sequence text[] not null default '{}', -- derived; used by analytics and originality checks
  offer_id uuid references offers,                -- must belong to the same market (checked in code)
  campaign_id text unique, utm_json jsonb,        -- [S§13.1]
  content_length jsonb,                           -- {slides, wordsTotal, captionChars}
  generation_version text,                        -- 'p1.0.0' (pipeline version)
  generation_config  jsonb,                       -- GenerationConfig
  pipeline_state     jsonb,                       -- PipelineState (resume after crash)
  quality_score numeric(4,2),
  critic_verdict critic_verdict, critic_report jsonb,   -- CriticReport
  differentiation_report jsonb,                          -- DifferentiationReport
  flags text[] not null default '{}',             -- see §4.4 VariantFlag
  lock_version int not null default 0,            -- optimistic locking for concurrent reviewers
  last_error jsonb,
  status_changed_at timestamptz not null default now(),
  ts
  -- current_render_id (0004), approved_version_id (0005), experiment_id + experiment_arm (0008)
);
create unique index content_variants_active_uq on content_variants (master_idea_id, market_id, format)
  where status <> 'REJECTED';
create index content_variants_market_status_idx on content_variants (market_id, status);
create index content_variants_status_updated_idx on content_variants (status, updated_at desc);

alter table generation_runs
  add column master_idea_id     uuid references master_ideas,
  add column content_variant_id uuid references content_variants;
create index generation_runs_variant_idx on generation_runs (content_variant_id);

create table voice_examples (                    -- P1 [S§20: Sergey's edits]
  pk, market_id uuid references markets,         -- null = all markets
  kind text not null check (kind in ('EDIT_PAIR','EXEMPLAR','RULE')),
  before_text text, after_text text, note text, language text,
  source text not null check (source in ('SEED','REVIEW_EVENT')),
  review_event_id uuid,                          -- FK added in 0005
  is_active boolean not null default true, ts
);
```

### 0004_creative (M3-01)
```sql
create table visual_assets (
  pk, brand_id uuid not null references brands,
  kind   text not null check (kind in ('GENERATED','LIBRARY_PHOTO','UPLOADED')),
  status asset_status not null default 'PENDING',
  source_asset_id    uuid references source_assets,       -- LIBRARY_PHOTO origin
  content_variant_id uuid references content_variants,
  slide_id text, slot text,
  provider text, model text, prompt text, negative_prompt text, prompt_hash text, seed text, params jsonb,
  generation_run_id uuid references generation_runs,
  storage_key text, original_key text, mime_type text, width int, height int, bytes int,
  phash text,                                    -- perceptual hash (duplication checks)
  is_ai_generated boolean not null default false,
  description text, tags text[] not null default '{}',
  rights jsonb, error jsonb, ts
);
create unique index visual_assets_gen_uq on visual_assets (content_variant_id, slide_id, slot, prompt_hash)
  where kind = 'GENERATED' and status in ('PENDING','READY');
create index visual_assets_kind_status_idx on visual_assets (kind, status);

create table carousel_renders (
  pk, content_variant_id uuid not null references content_variants,
  input_hash text not null,                      -- hash(slides + asset ids + theme + template versions)
  status render_status not null default 'PENDING',
  width int not null default 1080, height int not null default 1350,
  slide_count int, templates_version text not null,
  qa_report jsonb, error jsonb, trigger_run_id text,
  created_at timestamptz not null default now(), completed_at timestamptz,
  unique (content_variant_id, input_hash)
);

create table rendered_slides (
  pk, carousel_render_id uuid not null references carousel_renders on delete cascade,
  slide_index int not null, slide_id text not null, template_id text not null,
  storage_key text not null, width int not null, height int not null, bytes int not null, sha256 text not null,
  unique (carousel_render_id, slide_index)
);

alter table content_variants add column current_render_id uuid references carousel_renders;
```

### 0005_review_scheduling (M4-01)
```sql
create table review_events (                     -- [S§5, §10.3]
  pk, content_variant_id uuid not null references content_variants,
  action review_action not null,
  field text,                                    -- FieldPath (§4.4)
  original_value jsonb, edited_value jsonb,      -- jsonb because slides are structured [C-07]
  reviewer_id uuid references app_users,         -- spec: reviewer; null = system
  reason_code text, reason text,                 -- reason_code: taxonomy kind 'reason_code'
  generation_run_id uuid references generation_runs,
  variant_lock_version int not null,
  created_at timestamptz not null default now()
);
create index review_events_variant_idx on review_events (content_variant_id, created_at);
create index review_events_reason_idx  on review_events (reason_code);
alter table voice_examples add constraint voice_examples_review_event_fk
  foreign key (review_event_id) references review_events;

create table content_variant_versions (          -- approved, immutable snapshots [S§19]
  pk, content_variant_id uuid not null references content_variants,
  version_no int not null,
  snapshot jsonb not null,                       -- ApprovedSnapshot
  carousel_render_id uuid not null references carousel_renders,
  content_hash text not null,
  approved_by uuid not null references app_users,
  approved_at timestamptz not null default now(),
  unique (content_variant_id, version_no)
);
alter table content_variants add column approved_version_id uuid references content_variant_versions;

create table social_accounts (                   -- [S§5]
  pk, market_id uuid not null references markets,
  platform text not null default 'instagram',
  username text not null,
  instagram_account_id text not null,            -- professional account id used in publish calls ⚠ V-03
  app_scoped_user_id text,
  account_type text,                             -- BUSINESS | MEDIA_CREATOR
  access_token_encrypted text not null,          -- 'enc:v1:…' (D-18)
  token_expires_at timestamptz, token_last_refreshed_at timestamptz,
  token_status token_status not null default 'VALID',
  scopes text[] not null default '{}',
  status social_account_status not null default 'ACTIVE',
  connected_at timestamptz not null default now(), connected_by uuid references app_users,
  last_health_check_at timestamptz, last_health jsonb,   -- {ok, quotaUsage, quotaTotal, error}
  ts, unique (platform, instagram_account_id)
);
create unique index social_accounts_one_active_uq on social_accounts (market_id, platform) where status = 'ACTIVE';

create table publications (                      -- [S§5, §11]
  pk,
  content_variant_id         uuid not null references content_variants,
  content_variant_version_id uuid not null references content_variant_versions,
  market_id                  uuid not null references markets,
  social_account_id          uuid references social_accounts,   -- resolved at dispatch time
  mode         text not null check (mode in ('IMMEDIATE','SCHEDULED')),
  scheduled_at timestamptz,
  status       publication_status not null,
  step         text,                              -- CREATE_CHILDREN | CREATE_PARENT | WAIT_READY | PUBLISH | FINALIZE
  dry_run      boolean not null default false,
  idempotency_key text not null unique,           -- 'pub:{publicationId}:{retryNo}'
  retry_no     int not null default 0,
  attempt_count int not null default 0,
  ig_children_container_ids text[] not null default '{}',
  ig_container_id text, ig_container_status text,
  instagram_media_id text unique, permalink text, published_at timestamptz,
  follower_count_at_publish int,                  -- posting context [S§12]
  last_error jsonb,                               -- InstagramError
  trigger_run_id text,
  created_by uuid references app_users,
  cancelled_by uuid references app_users, cancelled_at timestamptz,
  ts
);
create unique index publications_one_live_per_variant_uq on publications (content_variant_id)
  where dry_run = false and status in ('SCHEDULED','QUEUED','IN_PROGRESS','PUBLISHED');   -- [S§11.1] no duplicates
create index publications_due_idx on publications (status, scheduled_at);
```

### 0006_instagram_ops (M5-01)
```sql
create table publish_attempts (                  -- audit log of publish calls [S§11.1]
  pk, publication_id uuid not null references publications,
  attempt_no int not null, step text not null,
  endpoint text not null,                        -- path only; never the query string
  request jsonb, http_status int, response jsonb, -- both redacted
  outcome text not null check (outcome in ('OK','TRANSIENT_ERROR','PERMANENT_ERROR','AMBIGUOUS')),
  error_code text, error_subcode text, fbtrace_id text,
  duration_ms int, trigger_run_id text,
  created_at timestamptz not null default now()
);
create index publish_attempts_pub_idx on publish_attempts (publication_id, created_at);

create table integration_events (                -- external API errors and health [S§23 item 13]
  pk, integration text not null,                 -- instagram | anthropic | openai | r2 | trigger
  social_account_id uuid references social_accounts,
  severity text not null check (severity in ('INFO','WARN','ERROR')),
  code text not null, message text not null, details jsonb,
  occurred_at timestamptz not null default now(), resolved_at timestamptz
);
create index integration_events_open_idx on integration_events (integration, occurred_at desc) where resolved_at is null;
```

### 0007_analytics (M6-01)
```sql
create table metric_snapshots (                  -- [S§5, §12.1]
  pk, publication_id uuid not null references publications,
  snapshot_slot snapshot_slot not null,
  measured_at timestamptz not null,
  media_age_hours numeric(8,2) not null,
  reach int, views int, likes int, comments int, saves int, shares int, total_interactions int,
  profile_actions_json jsonb,                    -- {profileVisits, follows, profileActivity:{…}}
  follower_change int,                           -- follows attributed to the media, if available
  video_metrics_json jsonb,                      -- Reels (post-MVP)
  raw_metrics_json jsonb not null,
  api_version text not null,
  created_at timestamptz not null default now()
);
create unique index metric_snapshots_slot_uq on metric_snapshots (publication_id, snapshot_slot)
  where snapshot_slot <> 'MANUAL';

create table account_metric_snapshots (          -- account-level growth metrics [C-03]
  pk, social_account_id uuid not null references social_accounts,
  metric_date date not null,                     -- market-local day
  measured_at timestamptz not null,
  followers_count int, follows int, unfollows int,
  reach int, reach_followers int, reach_non_followers int,
  views int, accounts_engaged int, total_interactions int,
  raw jsonb not null, api_version text not null,
  unique (social_account_id, metric_date)
);

create table attribution_events (                -- leads and sales [S§13.1]
  pk, market_id uuid not null references markets,
  type attribution_event_type not null,
  occurred_at timestamptz not null,
  campaign_id text,                              -- matches content_variants.campaign_id (no FK: imports may contain unknown ids)
  offer_id uuid references offers,
  quantity int not null default 1, amount numeric(12,2), currency char(3),
  source text not null check (source in ('MANUAL','CSV_IMPORT','WEBHOOK')),
  external_ref text,                             -- order id or its hash; never customer PII (A-10)
  utm jsonb, import_batch_id uuid, notes text,
  created_by uuid references app_users,
  created_at timestamptz not null default now(),
  unique (source, external_ref)
);
```
Views in the same migration: `v_publication_dimensions`, `v_publication_metrics_d7`, `v_campaign_attribution` (definitions in 11 §11.3).

### 0008_learning (M7-01)
```sql
create table performance_summaries (             -- "performance memory" [S§12.4]
  pk, market_id uuid references markets,         -- null = cross-market
  window_start date not null, window_end date not null,
  summary_json jsonb not null,                   -- PerformanceMemory (11 §11.5)
  stats_json   jsonb not null,
  min_sample int not null, publications_count int not null,
  created_by_type actor_type not null,
  created_at timestamptz not null default now()
);
create index performance_summaries_market_idx on performance_summaries (market_id, created_at desc);

create table experiments (                       -- [S§5]
  pk, name text not null, hypothesis text not null,
  market_id uuid references markets,
  dimension text not null,                       -- 'hook_type' | 'visual_style' | 'cta_type' | 'posting_time' | …
  variant_a text not null, variant_b text not null,
  primary_metric text not null default 'save_rate',
  min_posts_per_arm int not null default 5,
  status experiment_status not null default 'DRAFT',
  start_at timestamptz, end_at timestamptz, notes text,
  created_by uuid references app_users, ts
);

alter table content_variants
  add column experiment_id  uuid references experiments,
  add column experiment_arm text check (experiment_arm in ('A','B'));
alter table master_ideas
  add column performance_summary_id uuid references performance_summaries;   -- spec: created_from_metrics_window
```

## 4.4 JSON field shapes (Zod schemas in `db/src/json/`)

```ts
type Permission = 'ALLOWED' | 'DENIED' | 'UNKNOWN';
interface RightsPolicy {            // [S§6.2] one flag per permission
  use: Permission; translate: Permission; adapt: Permission; visuallyTransform: Permission;
  sell: Permission; aiProcessing: Permission; improvePrompts: Permission;
  notes?: string; confirmedBy?: string /* app_users.id */; confirmedAt?: string /* ISO */;
}
type RightsDefaults = Record<SourceType, RightsPolicy>;          // app_settings 'rights.defaults'

interface SourceReference {         // [C-06]
  pageStart?: number; pageEnd?: number; sectionPath?: string;
  locator?: { startMs?: number; endMs?: number; externalId?: string };
  quote: string;                    // verbatim, source language, ≤ 400 chars
  quoteVerified: boolean; matchScore?: number; note?: string;
}
interface ProcedureStep { n: number; text: string }
interface Ingredient    { name: string; quantity?: number; unit?: string; note?: string }
interface Temperature   { value: number; unit: 'C' | 'F';
                          target: 'OVEN'|'PAN'|'OIL'|'WATER'|'CORE'|'FRIDGE'|'FREEZER'|'OTHER'; context: string }
interface Timing        { value: number; valueMax?: number; unit: 's'|'min'|'h'|'d'; context: string }
interface CommonMistake { mistake: string; why?: string; fix?: string }

interface VisualSystem {            // brands.visual_system
  colors: { background: string; surface: string; text: string; accent: string; positive: string; negative: string };
  fonts: { display: string; body: string };          // font family ids bundled in @rc/templates
  logo: { assetKey: string; minHeightPx: number };
  spacing: { safeMarginPx: number };
  themeVariants: Record<string, Partial<VisualSystem['colors']>>;   // e.g. 'warm-mediterranean'
}
interface VocabularyEntry  { concept: string; preferred: string; avoid?: string[]; note?: string }
interface ForbiddenPattern { pattern: string; kind: 'PHRASE' | 'REGEX'; reason: string }
interface VisualHypothesis { id: string; description: string; visualStyle: string; themeVariant?: string; status: 'UNTESTED'|'TESTING'|'CONFIRMED'|'REJECTED' }

type SlideRole = 'HOOK'|'PROBLEM'|'EXPLANATION'|'STEP'|'MISTAKE'|'CORRECT'|'FACT'|'COMPARISON'|'SUMMARY'|'CTA';
interface Slide {
  id: string;                       // nanoid; stable across edits (used in field paths)
  index: number; role: SlideRole;
  templateId: 'A'|'B'|'C'|'D'|'E'|'F';
  slots: Record<string, string>;    // text slots defined by the template (08 §8.2)
  images: Record<string, { assetId?: string }>;   // image slots
  knowledgeIds: string[];           // cited cards (must be linked to the Master Idea)
  factual: boolean;                 // true → must cite ≥ 1 card
  altText?: string;
}
interface CtaSpec { type: string /* taxonomy cta_type */; text: string; keyword?: string; offerId?: string;
                    linkMode?: 'LINK_IN_BIO' | 'DM' | 'NONE' }
interface UtmSpec { source: 'instagram'; medium: 'social'; campaign: string; content: string; url?: string }

interface MarketBrief {             // output of the market adapter [S§7.2]
  audienceFraming: string;
  terminology: { concept: string; localTerm: string; avoid: string[] }[];
  substitutions: { original: string; local: string; note: string; factualImpact: 'NONE' | 'NEEDS_CHECK' }[];
  unitsPolicy: { system: 'METRIC'|'IMPERIAL'|'DUAL'; conversions: { from: string; to: string }[] };
  culturalHooks: string[]; examples: string[]; tone: string;
  hookType: string;                 // taxonomy
  slidePlan: { role: SlideRole; templateId: Slide['templateId']; purpose: string; knowledgeIds: string[] }[];
  ctaApproach: { ctaType: string; keywordSuggestion?: string };
  risks: string[]; differentiationNotes: string;
}
interface VisualBrief {
  concept: string; visualStyle: string; hypothesisId?: string;
  slides: { slideId: string; slot: string; source: 'GENERATE'|'LIBRARY'|'NONE'; libraryAssetId?: string;
            prompt?: string; negativePrompt?: string; composition: string; aspect: '4:5'|'1:1'|'3:4'|'16:9' }[];
  differentiationFromSibling: string;
}
interface ValidationIssue { code: string; severity: 'BLOCKER'|'MAJOR'|'MINOR'; fieldPath?: string; message: string; fixHint?: string }
interface CriticReport {
  verdict: 'PASS'|'REQUEST_REWRITE'|'FLAG_FOR_HUMAN'; iteration: number;
  scores: { factualFidelity: number; sourceCoverage: number; localization: number; originality: number;
            brandVoice: number; structure: number; cta: number; overall: number };   // 1–5
  unsupportedClaims: { fieldPath: string; text: string; reason: string }[];
  issues: { severity: 'BLOCKER'|'MAJOR'|'MINOR'; category: string; fieldPath?: string; explanation: string; suggestedFix?: string }[];
  rewriteInstructions?: string; humanAttention?: string;
  deterministicIssues: ValidationIssue[];
}
interface DifferentiationReport {
  hookSimilarity: number; slideTextSimilarity: number; templateSequenceSimilarity: number; sameHookType: boolean;
  visualPromptSimilarity?: number; verdict: 'OK'|'WARN'|'FAIL'; reasons: string[]; thresholdsVersion: string;
}
interface GenerationConfig {
  pipelineVersion: string;          // semver in modules/ai/version.ts
  stages: Record<string, { promptId: string; promptVersion: number; model: string; effort?: string }>;
  templatesVersion?: string; imageModel?: string; embeddingModel: string;
}
interface PipelineState { pipelineRunId: string; stage: string; startedAt: string; completedStages: string[]; runIds: Record<string, string> }
interface ApprovedSnapshot {
  hook: string; hookType: string; caption: string; cta: CtaSpec; hashtags: string[];
  slides: Slide[]; visualStyle: string; templateSequence: string[];
  offerId?: string; campaignId?: string; utm?: UtmSpec;
  renderId: string; renderedSlideKeys: string[];
  knowledge: { id: string; version: number }[]; generationVersion: string;
}
interface QaReport {
  overflow: { slideId: string; slot: string; fontPxUsed: number }[];
  missingGlyphs: { slideId: string; slot: string; chars: string[] }[];
  dimensionsOk: boolean; logoPlacementOk: boolean; fileSizes: number[]; durationMs: number;
}
interface InstagramError {
  httpStatus?: number; code?: number; subcode?: number; type?: string; message: string; fbtraceId?: string;
  classification: 'TRANSIENT'|'RATE_LIMIT'|'AUTH'|'PERMISSION'|'INVALID_MEDIA'|'PERMANENT'|'UNKNOWN';
}
type VariantFlag = 'GENERATION_FAILED'|'UNSUPPORTED_CLAIM'|'SAFETY_REVIEW'|'DUPLICATION_RISK'|'NUMERIC_MISMATCH'
                 | 'TEXT_OVERFLOW'|'MISSING_GLYPH'|'RENDER_FAILED'|'VISUAL_MISSING'|'KNOWLEDGE_CHANGED'|'KNOWLEDGE_ARCHIVED';
// Blocking flags for approval: UNSUPPORTED_CLAIM, NUMERIC_MISMATCH, TEXT_OVERFLOW, MISSING_GLYPH,
//                              RENDER_FAILED, VISUAL_MISSING, KNOWLEDGE_ARCHIVED (+ SAFETY_REVIEW needs a checklist)

// FieldPath grammar (review events, edits, regeneration)
type FieldPath = 'hook' | 'caption' | 'cta' | 'hashtags' | 'visualBrief'
  | `slides.${string}`                       // whole slide (by slide id)
  | `slides.${string}.slots.${string}`       // one text slot
  | `slides.${string}.images.${string}`;     // one image slot
```

## 4.5 Main query patterns and indexes

| Query | Served by |
|---|---|
| Sources by status (list, progress polling) | `source_assets_status_idx` |
| Cards to review by status/category; flags filter | `knowledge_status_cat_idx`, `knowledge_flags_idx` |
| Semantic search over approved cards (`<=>` cosine) + filters | `knowledge_embedding_idx` (HNSW) + status filter |
| Drafts by market/status; review queue | `content_variants_market_status_idx`, `content_variants_status_updated_idx` |
| Dispatcher: due scheduled publications (`status='SCHEDULED' and scheduled_at <= now()`) | `publications_due_idx` |
| Duplicate protection | `publications_one_live_per_variant_uq`, `publications.idempotency_key` unique, `instagram_media_id` unique |
| Insights: due snapshot slots | `metric_snapshots_slot_uq` + `publications.published_at` |
| Audit trail for an entity | `audit_entity_idx` |

## 4.6 Lineage query (answers the §5 question)

```sql
select p.instagram_media_id, p.permalink, p.published_at, m.code as market,
       mi.id as master_idea_id, mi.topic, mi.category, mi.angle,
       cv.hook, cv.hook_type, cv.visual_style, cv.cta_type, cv.template_sequence, o.name as offer, cv.campaign_id,
       ki.id as knowledge_item_id, mik.knowledge_version, ki.title as card_title,
       sa.title as source_title, ki.source_reference ->> 'pageStart' as source_page,
       d7.reach, d7.saves, d7.shares, d7.save_rate, d7.share_rate
from publications p
join content_variant_versions v on v.id = p.content_variant_version_id
join content_variants cv        on cv.id = p.content_variant_id
join markets m                  on m.id = cv.market_id
join master_ideas mi            on mi.id = cv.master_idea_id
join master_idea_knowledge mik  on mik.master_idea_id = mi.id
join knowledge_items ki         on ki.id = mik.knowledge_item_id
left join source_assets sa      on sa.id = ki.source_asset_id
left join offers o              on o.id = cv.offer_id
left join v_publication_metrics_d7 d7 on d7.publication_id = p.id
where p.id = $1;
```
The market adaptation used is in `content_variants.market_brief_json` (and the exact prompt/model in `generation_runs`). The exact approved copy is in `content_variant_versions.snapshot`.

## 4.7 Migration rules
1. One numbered migration per milestone (0000–0008). Later fixes get new numbers; merged migrations are never edited.
2. Generate with `pnpm db:generate` (drizzle-kit). Add custom SQL (RLS, `set_updated_at` triggers, partial/HNSW indexes if drizzle-kit cannot express them) to the same file with a clear comment block.
3. Expand → migrate → contract. A deploy never removes or renames a column that the previous app version still uses.
4. Every migration must apply on PGlite (tests) and on Supabase. Supabase-only statements (e.g. `extensions` schema) are guarded or kept in `0000`.
5. Seeds (`pnpm db:seed`) are idempotent upserts: brand, markets (es-ES and en active; fr-FR inactive), taxonomy terms, owner allowlist, default `app_settings`.
6. Status changes go through the transition helper (`modules/core/transition.ts`): `update … set status = $to where id = $id and status = any($allowedFrom) returning *`. Zero rows → `InvalidStateError`.

**Initial taxonomy seed** (to be refined with Sergey, Track B B-08):
- `category`: FISH_SEAFOOD, MEAT, POULTRY, EGGS, DAIRY, VEGETABLES, GRAINS_RICE_PASTA, BAKING_DOUGH, SAUCES_STOCKS, TECHNIQUES, FOOD_SCIENCE, EQUIPMENT, STORAGE_SAFETY, SPICES_SEASONING.
- `angle`: COMMON_MISTAKE, MYTH_VS_FACT, SCIENCE_EXPLAINER, TECHNIQUE_HOW_TO, COMPARISON, INGREDIENT_SPOTLIGHT, QUICK_TIP, CHECKLIST, RECIPE_WALKTHROUGH, TROUBLESHOOTING.
- `hook_type`: MISTAKE_CALLOUT, CURIOSITY_GAP, NUMBER_OR_STAT, MYTH_BUST, BOLD_CLAIM, DIRECT_QUESTION, BEFORE_AFTER, HOW_TO_PROMISE, CONTRARIAN, RELATABLE_PROBLEM.
- `cta_type`: SAVE, SHARE, FOLLOW, COMMENT_KEYWORD, DM_KEYWORD, LINK_IN_BIO, NONE.
- `visual_style`: EDITORIAL_MACRO, FOOD_SCIENCE_DIAGRAM, WARM_MEDITERRANEAN, CLEAN_STUDIO, DARK_MOODY, TEXT_FORWARD.
- `reason_code`: WEAK_HOOK, FACTUAL_ERROR, UNSUPPORTED_CLAIM, UNNATURAL_LANGUAGE, TRANSLATIONESE, WRONG_TERMINOLOGY, OFF_BRAND_VOICE, TOO_LONG, VISUAL_ISSUE, TOO_SIMILAR_TO_OTHER_MARKET, CTA_ISSUE, SAFETY, OTHER.

## 4.8 Changes against the spec data model

| Spec | Implementation | Why |
|---|---|---|
| `source_assets.file_url` | `file_key` (R2 key) + presigned URLs on demand | Private storage, signed URLs [S§19] [C-05] |
| `source_assets.rights_status` only | `rights_status` + `rights` (RightsPolicy JSON with 7 permissions) | [S§6.2] asks for per-permission rights |
| `knowledge_items.source_reference` (text) | JSON: page range, section, verbatim quote, `quoteVerified` | Traceability test [S§18] [C-06] |
| `knowledge_items.embedding` | kept + `embedding_model`, `embedding_hash` | Re-embedding safety (D-11) |
| `offers.source_product_id` | `offers.product_id` → new `products` table | The referenced catalog did not exist [C-01] |
| `master_ideas.offer_id` | `master_ideas.product_id` + `content_variants.offer_id` | Offers are market-scoped; ideas are cross-market [C-01] |
| `master_ideas.created_from_metrics_window` | `performance_summary_id` FK (0008) | Points to the exact summary used |
| `content_variants` | + hook_type, cta_type/cta_json, hashtags, market_brief_json, visual_style, template_sequence, offer_id, campaign_id, utm_json, content_length, generation_config, critic fields, flags, lock_version, render/version FKs | Content dimensions [S§12.2], attribution [S§13.1], critic [S§7.2] |
| Content statuses [S§7.4] | + `PUBLISHING`, `REJECTED` | Reject exists in the review flow but not in the status list [C-02] |
| `review_events.original_value/edited_value` (text) | jsonb + `action`, `reason_code`, `generation_run_id`, `variant_lock_version` | Slides are structured; regeneration history [C-07] |
| `review_events.reviewer` | `reviewer_id` FK | – |
| `publications` | + version FK, market, mode, scheduling, step, container ids, idempotency key, errors | Safeguards [S§11.1] |
| `metric_snapshots` | + snapshot_slot, media_age_hours, total_interactions, api_version | Comparable snapshots [S§12.1] |
| – | New: `app_users`, `taxonomy_terms`, `app_settings`, `audit_events`, `source_pages`, `source_chunks`, `knowledge_extraction_batches`, `knowledge_item_versions`, `generation_runs`, `historical_posts`, `products`, `voice_examples`, `visual_assets`, `carousel_renders`, `rendered_slides`, `content_variant_versions`, `publish_attempts`, `integration_events`, `account_metric_snapshots`, `attribution_events`, `performance_summaries` | Required by [S§6, §8, §10.3, §11.1, §12, §13, §19, §20] but missing from [S§5] [C-03, C-04] |
