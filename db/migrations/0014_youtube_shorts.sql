CREATE TYPE "public"."youtube_upload_status" AS ENUM('QUEUED', 'IN_PROGRESS', 'PUBLISHED', 'DRY_RUN_PASSED', 'FAILED');--> statement-breakpoint
CREATE TABLE "youtube_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_variant_id" uuid NOT NULL,
	"content_variant_version_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"status" "youtube_upload_status" DEFAULT 'QUEUED' NOT NULL,
	"step" text DEFAULT 'GUARDS' NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"trigger_run_id" text,
	"channel_id" text,
	"metadata" jsonb,
	"upload_session_encrypted" text,
	"upload_started_at" timestamp with time zone,
	"youtube_video_id" text,
	"url" text,
	"upload_status" text,
	"processing_status" text,
	"published_at" timestamp with time zone,
	"last_error" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "youtube_uploads_video_id_unique" UNIQUE("youtube_video_id")
);
--> statement-breakpoint
ALTER TABLE "youtube_uploads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "youtube_uploads" ADD CONSTRAINT "youtube_uploads_content_variant_id_content_variants_id_fk" FOREIGN KEY ("content_variant_id") REFERENCES "public"."content_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_uploads" ADD CONSTRAINT "youtube_uploads_content_variant_version_id_content_variant_versions_id_fk" FOREIGN KEY ("content_variant_version_id") REFERENCES "public"."content_variant_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_uploads" ADD CONSTRAINT "youtube_uploads_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_uploads" ADD CONSTRAINT "youtube_uploads_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_uploads" ADD CONSTRAINT "youtube_uploads_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "youtube_uploads_one_live_per_variant_uq" ON "youtube_uploads" USING btree ("content_variant_id") WHERE "youtube_uploads"."dry_run" = false and "youtube_uploads"."status" in ('QUEUED', 'IN_PROGRESS', 'PUBLISHED');--> statement-breakpoint
CREATE INDEX "youtube_uploads_publication_idx" ON "youtube_uploads" USING btree ("publication_id");--> statement-breakpoint
CREATE INDEX "youtube_uploads_status_idx" ON "youtube_uploads" USING btree ("status","created_at");--> statement-breakpoint
-- Kept current by the trigger, like the other tables that have updated_at. set_updated_at()
-- comes from 0001_core.
CREATE TRIGGER youtube_uploads_set_updated_at BEFORE UPDATE ON "youtube_uploads"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
