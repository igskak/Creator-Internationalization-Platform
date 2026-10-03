CREATE TYPE "public"."batch_status" AS ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."content_format" AS ENUM('CAROUSEL', 'REEL', 'SINGLE_IMAGE');--> statement-breakpoint
CREATE TYPE "public"."generation_stage" AS ENUM('KNOWLEDGE_EXTRACTION', 'IDEA_GENERATION', 'MARKET_ADAPTATION', 'CONTENT_WRITING', 'CRITIC', 'VISUAL_DIRECTION', 'FIELD_REGENERATION', 'POST_ANNOTATION', 'KNOWLEDGE_GLOSS', 'VISUAL_QA', 'EVAL_JUDGE', 'PAGE_TRANSCRIPTION');--> statement-breakpoint
CREATE TYPE "public"."knowledge_origin" AS ENUM('SOURCE_EXTRACTED', 'MANUAL', 'EXTERNAL_RESEARCH');--> statement-breakpoint
CREATE TYPE "public"."knowledge_status" AS ENUM('EXTRACTED', 'NEEDS_REVIEW', 'CHEF_APPROVED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."processing_status" AS ENUM('PENDING_UPLOAD', 'UPLOADED', 'QUEUED', 'PROCESSING', 'READY', 'FAILED', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."rights_status" AS ENUM('UNKNOWN', 'PENDING_REVIEW', 'CLEARED', 'RESTRICTED');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('SUCCEEDED', 'REPAIRED', 'INVALID_OUTPUT', 'REFUSED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('BOOK', 'GUIDE', 'RECIPE', 'INSTAGRAM_POST', 'VIDEO', 'TRANSCRIPT', 'PHOTO', 'NOTE', 'PRODUCT_MATERIAL');--> statement-breakpoint
CREATE TABLE "generation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage" "generation_stage" NOT NULL,
	"prompt_id" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"prompt_hash" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"params" jsonb NOT NULL,
	"request" jsonb,
	"input_refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"output" jsonb,
	"status" "run_status" NOT NULL,
	"validation_errors" jsonb,
	"repair_attempts" integer DEFAULT 0 NOT NULL,
	"stop_reason" text,
	"usage" jsonb,
	"cost_usd" numeric(10, 4),
	"latency_ms" integer,
	"error" jsonb,
	"parent_run_id" uuid,
	"trigger_run_id" text,
	"source_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "historical_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"source_asset_id" uuid,
	"platform" text DEFAULT 'instagram' NOT NULL,
	"account_handle" text NOT NULL,
	"external_id" text NOT NULL,
	"permalink" text,
	"posted_at" timestamp with time zone,
	"format" "content_format",
	"caption" text,
	"media_count" integer,
	"language" text,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"annotations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"annotation_status" text DEFAULT 'NONE' NOT NULL,
	"is_exemplar" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "historical_posts_platform_external_uq" UNIQUE("platform","external_id"),
	CONSTRAINT "historical_posts_annotation_status_check" CHECK ("historical_posts"."annotation_status" in ('NONE', 'AI_SUGGESTED', 'HUMAN_CONFIRMED'))
);
--> statement-breakpoint
ALTER TABLE "historical_posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "knowledge_extraction_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_asset_id" uuid NOT NULL,
	"processing_attempt" integer NOT NULL,
	"batch_index" integer NOT NULL,
	"page_start" integer NOT NULL,
	"page_end" integer NOT NULL,
	"mode" text NOT NULL,
	"status" "batch_status" DEFAULT 'PENDING' NOT NULL,
	"generation_run_id" uuid,
	"cards_created" integer DEFAULT 0 NOT NULL,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_batches_attempt_index_uq" UNIQUE("source_asset_id","processing_attempt","batch_index"),
	CONSTRAINT "knowledge_batches_mode_check" CHECK ("knowledge_extraction_batches"."mode" in ('PDF_NATIVE', 'TEXT'))
);
--> statement-breakpoint
ALTER TABLE "knowledge_extraction_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "knowledge_item_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"knowledge_item_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"status" "knowledge_status" NOT NULL,
	"changed_by" uuid,
	"change_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_versions_item_version_uq" UNIQUE("knowledge_item_id","version")
);
--> statement-breakpoint
ALTER TABLE "knowledge_item_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "knowledge_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"subcategory" text,
	"claim" text NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"procedure_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ingredients_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"temperatures_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"timings_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"common_mistakes_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_asset_id" uuid,
	"source_reference" jsonb,
	"language" text NOT NULL,
	"origin" "knowledge_origin" NOT NULL,
	"confidence" numeric(3, 2),
	"review_status" "knowledge_status" DEFAULT 'EXTRACTED' NOT NULL,
	"review_flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"safety_sensitive" boolean DEFAULT false NOT NULL,
	"safety_notes" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"approved_version" integer,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"archive_reason" text,
	"duplicate_of_id" uuid,
	"extraction_batch_id" uuid,
	"generation_run_id" uuid,
	"ordinal_in_batch" integer,
	"gloss_en" jsonb,
	"embedding" vector(1536),
	"embedding_model" text,
	"embedding_hash" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_items_batch_ordinal_uq" UNIQUE("extraction_batch_id","ordinal_in_batch")
);
--> statement-breakpoint
ALTER TABLE "knowledge_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "source_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"type" "source_type" NOT NULL,
	"title" text NOT NULL,
	"file_key" text,
	"original_filename" text,
	"mime_type" text,
	"file_size_bytes" bigint,
	"checksum_sha256" text,
	"original_language" text NOT NULL,
	"source_author" text,
	"rights_status" "rights_status" DEFAULT 'UNKNOWN' NOT NULL,
	"rights" jsonb NOT NULL,
	"processing_status" "processing_status" DEFAULT 'PENDING_UPLOAD' NOT NULL,
	"processing_attempt" integer DEFAULT 0 NOT NULL,
	"processing_progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processing_error" jsonb,
	"page_count" integer,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "source_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "source_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_asset_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"page_start" integer,
	"page_end" integer,
	"section_path" text,
	"text" text NOT NULL,
	"token_estimate" integer NOT NULL,
	"language" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector(1536),
	"embedding_model" text,
	"processing_attempt" integer NOT NULL,
	CONSTRAINT "source_chunks_asset_chunk_uq" UNIQUE("source_asset_id","chunk_index")
);
--> statement-breakpoint
ALTER TABLE "source_chunks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "source_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_asset_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"section_path" text,
	"text" text DEFAULT '' NOT NULL,
	"char_count" integer NOT NULL,
	"has_text_layer" boolean DEFAULT true NOT NULL,
	"transcribed" boolean DEFAULT false NOT NULL,
	"locator" jsonb,
	"processing_attempt" integer NOT NULL,
	CONSTRAINT "source_pages_asset_page_uq" UNIQUE("source_asset_id","page_number")
);
--> statement-breakpoint
ALTER TABLE "source_pages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_parent_run_id_generation_runs_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."generation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_source_asset_id_source_assets_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "public"."source_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_posts" ADD CONSTRAINT "historical_posts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_posts" ADD CONSTRAINT "historical_posts_source_asset_id_source_assets_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "public"."source_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_extraction_batches" ADD CONSTRAINT "knowledge_extraction_batches_source_asset_id_source_assets_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "public"."source_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_extraction_batches" ADD CONSTRAINT "knowledge_extraction_batches_generation_run_id_generation_runs_id_fk" FOREIGN KEY ("generation_run_id") REFERENCES "public"."generation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_versions" ADD CONSTRAINT "knowledge_item_versions_knowledge_item_id_knowledge_items_id_fk" FOREIGN KEY ("knowledge_item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_versions" ADD CONSTRAINT "knowledge_item_versions_changed_by_app_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_source_asset_id_source_assets_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "public"."source_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_approved_by_app_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_duplicate_of_id_knowledge_items_id_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."knowledge_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_extraction_batch_id_knowledge_extraction_batches_id_fk" FOREIGN KEY ("extraction_batch_id") REFERENCES "public"."knowledge_extraction_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_generation_run_id_generation_runs_id_fk" FOREIGN KEY ("generation_run_id") REFERENCES "public"."generation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_assets" ADD CONSTRAINT "source_assets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_assets" ADD CONSTRAINT "source_assets_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_source_asset_id_source_assets_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "public"."source_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_pages" ADD CONSTRAINT "source_pages_source_asset_id_source_assets_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "public"."source_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_runs_stage_idx" ON "generation_runs" USING btree ("stage","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "knowledge_status_cat_idx" ON "knowledge_items" USING btree ("review_status","category");--> statement-breakpoint
CREATE INDEX "knowledge_source_idx" ON "knowledge_items" USING btree ("source_asset_id");--> statement-breakpoint
CREATE INDEX "knowledge_flags_idx" ON "knowledge_items" USING gin ("review_flags");--> statement-breakpoint
CREATE INDEX "knowledge_embedding_idx" ON "knowledge_items" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "source_assets_status_idx" ON "source_assets" USING btree ("processing_status");--> statement-breakpoint
CREATE UNIQUE INDEX "source_assets_checksum_uq" ON "source_assets" USING btree ("brand_id","checksum_sha256") WHERE "source_assets"."checksum_sha256" is not null and "source_assets"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "source_chunks_embedding_idx" ON "source_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
-- ---------------------------------------------------------------------------------------------
-- Custom SQL (plan 04 §4.7 rule 2): updated_at triggers for the tables of this migration that
-- have the column. set_updated_at() comes from 0001_core.
-- ---------------------------------------------------------------------------------------------
CREATE TRIGGER source_assets_set_updated_at BEFORE UPDATE ON "source_assets"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER knowledge_extraction_batches_set_updated_at BEFORE UPDATE ON "knowledge_extraction_batches"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER knowledge_items_set_updated_at BEFORE UPDATE ON "knowledge_items"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER historical_posts_set_updated_at BEFORE UPDATE ON "historical_posts"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
