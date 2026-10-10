CREATE TYPE "public"."asset_status" AS ENUM('PENDING', 'READY', 'FAILED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."render_status" AS ENUM('PENDING', 'RENDERING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TABLE "carousel_renders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_variant_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"status" "render_status" DEFAULT 'PENDING' NOT NULL,
	"width" integer DEFAULT 1080 NOT NULL,
	"height" integer DEFAULT 1350 NOT NULL,
	"slide_count" integer,
	"templates_version" text NOT NULL,
	"qa_report" jsonb,
	"error" jsonb,
	"trigger_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "carousel_renders_variant_input_uq" UNIQUE("content_variant_id","input_hash")
);
--> statement-breakpoint
ALTER TABLE "carousel_renders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rendered_slides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carousel_render_id" uuid NOT NULL,
	"slide_index" integer NOT NULL,
	"slide_id" text NOT NULL,
	"template_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	CONSTRAINT "rendered_slides_render_index_uq" UNIQUE("carousel_render_id","slide_index")
);
--> statement-breakpoint
ALTER TABLE "rendered_slides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "visual_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" "asset_status" DEFAULT 'PENDING' NOT NULL,
	"source_asset_id" uuid,
	"content_variant_id" uuid,
	"slide_id" text,
	"slot" text,
	"provider" text,
	"model" text,
	"prompt" text,
	"negative_prompt" text,
	"prompt_hash" text,
	"seed" text,
	"params" jsonb,
	"generation_run_id" uuid,
	"storage_key" text,
	"original_key" text,
	"mime_type" text,
	"width" integer,
	"height" integer,
	"bytes" integer,
	"phash" text,
	"is_ai_generated" boolean DEFAULT false NOT NULL,
	"description" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"rights" jsonb,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visual_assets_kind_check" CHECK ("visual_assets"."kind" in ('GENERATED', 'LIBRARY_PHOTO', 'UPLOADED'))
);
--> statement-breakpoint
ALTER TABLE "visual_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_variants" ADD COLUMN "current_render_id" uuid;--> statement-breakpoint
ALTER TABLE "carousel_renders" ADD CONSTRAINT "carousel_renders_content_variant_id_content_variants_id_fk" FOREIGN KEY ("content_variant_id") REFERENCES "public"."content_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rendered_slides" ADD CONSTRAINT "rendered_slides_carousel_render_id_carousel_renders_id_fk" FOREIGN KEY ("carousel_render_id") REFERENCES "public"."carousel_renders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_assets" ADD CONSTRAINT "visual_assets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_assets" ADD CONSTRAINT "visual_assets_source_asset_id_source_assets_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "public"."source_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_assets" ADD CONSTRAINT "visual_assets_content_variant_id_content_variants_id_fk" FOREIGN KEY ("content_variant_id") REFERENCES "public"."content_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_assets" ADD CONSTRAINT "visual_assets_generation_run_id_generation_runs_id_fk" FOREIGN KEY ("generation_run_id") REFERENCES "public"."generation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "visual_assets_gen_uq" ON "visual_assets" USING btree ("content_variant_id","slide_id","slot","prompt_hash") WHERE "visual_assets"."kind" = 'GENERATED' and "visual_assets"."status" in ('PENDING', 'READY');--> statement-breakpoint
CREATE INDEX "visual_assets_kind_status_idx" ON "visual_assets" USING btree ("kind","status");--> statement-breakpoint
ALTER TABLE "content_variants" ADD CONSTRAINT "content_variants_current_render_id_carousel_renders_id_fk" FOREIGN KEY ("current_render_id") REFERENCES "public"."carousel_renders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Kept current by the trigger, like the other tables that have updated_at. set_updated_at()
-- comes from 0001_core.
CREATE TRIGGER visual_assets_set_updated_at BEFORE UPDATE ON "visual_assets"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
