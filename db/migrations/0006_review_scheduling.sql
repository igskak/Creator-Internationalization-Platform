CREATE TYPE "public"."review_action" AS ENUM('EDIT', 'REGENERATE', 'APPROVE', 'REJECT', 'REQUEST_CHANGES', 'RESUBMIT', 'UNAPPROVE', 'COMMENT');--> statement-breakpoint
CREATE TYPE "public"."publication_status" AS ENUM('SCHEDULED', 'QUEUED', 'IN_PROGRESS', 'PUBLISHED', 'FAILED', 'CANCELLED', 'DRY_RUN_PASSED');--> statement-breakpoint
CREATE TYPE "public"."social_account_status" AS ENUM('ACTIVE', 'NEEDS_REAUTH', 'DISABLED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."token_status" AS ENUM('VALID', 'EXPIRING', 'INVALID', 'REVOKED');--> statement-breakpoint
CREATE TABLE "content_variant_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_variant_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"carousel_render_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"approved_by" uuid NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_variant_versions_variant_no_uq" UNIQUE("content_variant_id","version_no")
);
--> statement-breakpoint
ALTER TABLE "content_variant_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "review_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_variant_id" uuid NOT NULL,
	"action" "review_action" NOT NULL,
	"field" text,
	"original_value" jsonb,
	"edited_value" jsonb,
	"reviewer_id" uuid,
	"reason_code" text,
	"reason" text,
	"generation_run_id" uuid,
	"variant_lock_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_variant_id" uuid NOT NULL,
	"content_variant_version_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"social_account_id" uuid,
	"mode" text NOT NULL,
	"scheduled_at" timestamp with time zone,
	"status" "publication_status" NOT NULL,
	"step" text,
	"dry_run" boolean DEFAULT false NOT NULL,
	"idempotency_key" text NOT NULL,
	"retry_no" integer DEFAULT 0 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"ig_children_container_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"ig_container_id" text,
	"ig_container_status" text,
	"instagram_media_id" text,
	"permalink" text,
	"published_at" timestamp with time zone,
	"follower_count_at_publish" integer,
	"last_error" jsonb,
	"trigger_run_id" text,
	"created_by" uuid,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publications_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "publications_instagram_media_id_unique" UNIQUE("instagram_media_id"),
	CONSTRAINT "publications_mode_check" CHECK ("publications"."mode" in ('IMMEDIATE', 'SCHEDULED'))
);
--> statement-breakpoint
ALTER TABLE "publications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"platform" text DEFAULT 'instagram' NOT NULL,
	"username" text NOT NULL,
	"instagram_account_id" text NOT NULL,
	"app_scoped_user_id" text,
	"account_type" text,
	"access_token_encrypted" text NOT NULL,
	"token_expires_at" timestamp with time zone,
	"token_last_refreshed_at" timestamp with time zone,
	"token_status" "token_status" DEFAULT 'VALID' NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "social_account_status" DEFAULT 'ACTIVE' NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connected_by" uuid,
	"last_health_check_at" timestamp with time zone,
	"last_health" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_accounts_platform_account_uq" UNIQUE("platform","instagram_account_id")
);
--> statement-breakpoint
ALTER TABLE "social_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_variants" ADD COLUMN "approved_version_id" uuid;--> statement-breakpoint
ALTER TABLE "content_variant_versions" ADD CONSTRAINT "content_variant_versions_content_variant_id_content_variants_id_fk" FOREIGN KEY ("content_variant_id") REFERENCES "public"."content_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_variant_versions" ADD CONSTRAINT "content_variant_versions_carousel_render_id_carousel_renders_id_fk" FOREIGN KEY ("carousel_render_id") REFERENCES "public"."carousel_renders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_variant_versions" ADD CONSTRAINT "content_variant_versions_approved_by_app_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_content_variant_id_content_variants_id_fk" FOREIGN KEY ("content_variant_id") REFERENCES "public"."content_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_reviewer_id_app_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_generation_run_id_generation_runs_id_fk" FOREIGN KEY ("generation_run_id") REFERENCES "public"."generation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_content_variant_id_content_variants_id_fk" FOREIGN KEY ("content_variant_id") REFERENCES "public"."content_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_content_variant_version_id_content_variant_versions_id_fk" FOREIGN KEY ("content_variant_version_id") REFERENCES "public"."content_variant_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_cancelled_by_app_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_connected_by_app_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_events_variant_idx" ON "review_events" USING btree ("content_variant_id","created_at");--> statement-breakpoint
CREATE INDEX "review_events_reason_idx" ON "review_events" USING btree ("reason_code");--> statement-breakpoint
CREATE UNIQUE INDEX "publications_one_live_per_variant_uq" ON "publications" USING btree ("content_variant_id") WHERE "publications"."dry_run" = false and "publications"."status" in ('SCHEDULED', 'QUEUED', 'IN_PROGRESS', 'PUBLISHED');--> statement-breakpoint
CREATE INDEX "publications_due_idx" ON "publications" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_one_active_uq" ON "social_accounts" USING btree ("market_id","platform") WHERE "social_accounts"."status" = 'ACTIVE';--> statement-breakpoint
ALTER TABLE "content_variants" ADD CONSTRAINT "content_variants_approved_version_id_content_variant_versions_id_fk" FOREIGN KEY ("approved_version_id") REFERENCES "public"."content_variant_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_examples" ADD CONSTRAINT "voice_examples_review_event_id_review_events_id_fk" FOREIGN KEY ("review_event_id") REFERENCES "public"."review_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- ---------------------------------------------------------------------------------------------
-- Custom SQL (plan 04 §4.7 rule 2): updated_at triggers for the new tables that have the column.
-- set_updated_at() comes from 0001_core.
-- ---------------------------------------------------------------------------------------------
CREATE TRIGGER social_accounts_set_updated_at BEFORE UPDATE ON "social_accounts"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER publications_set_updated_at BEFORE UPDATE ON "publications"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
