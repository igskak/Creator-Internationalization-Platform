CREATE TYPE "public"."reel_shot_status" AS ENUM('PENDING', 'RUNNING', 'READY', 'FAILED', 'BLOCKED');--> statement-breakpoint
ALTER TYPE "public"."generation_stage" ADD VALUE 'REEL_DIRECTION';--> statement-breakpoint
ALTER TYPE "public"."generation_stage" ADD VALUE 'REEL_SHOT';--> statement-breakpoint
CREATE TABLE "reel_renders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_variant_id" uuid NOT NULL,
	"reel_script_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"status" "render_status" DEFAULT 'PENDING' NOT NULL,
	"width" integer DEFAULT 1080 NOT NULL,
	"height" integer DEFAULT 1920 NOT NULL,
	"duration_ms" integer,
	"bytes" integer,
	"sha256" text,
	"storage_key" text,
	"audio_kind" text DEFAULT 'NONE' NOT NULL,
	"cost_usd" numeric(10, 4),
	"renderer_version" text NOT NULL,
	"qa_report" jsonb,
	"error" jsonb,
	"trigger_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "reel_renders_variant_input_uq" UNIQUE("content_variant_id","input_hash"),
	CONSTRAINT "reel_renders_ready_check" CHECK ("reel_renders"."status" <> 'READY' or "reel_renders"."storage_key" is not null),
	CONSTRAINT "reel_renders_audio_kind_check" CHECK ("reel_renders"."audio_kind" in ('NONE', 'PLACEHOLDER_BEAT', 'OWNER_TRACK'))
);
--> statement-breakpoint
ALTER TABLE "reel_renders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reel_scripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_variant_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"hook_options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"chosen_hook_id" text,
	"flash_opener" text DEFAULT 'ON' NOT NULL,
	"scenes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shot_model" text NOT NULL,
	"cost_estimate_usd" numeric(10, 4),
	"prompt_version" text,
	"generation_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reel_scripts_variant_version_uq" UNIQUE("content_variant_id","version"),
	CONSTRAINT "reel_scripts_version_check" CHECK ("reel_scripts"."version" > 0),
	CONSTRAINT "reel_scripts_flash_check" CHECK ("reel_scripts"."flash_opener" in ('ON', 'OFF'))
);
--> statement-breakpoint
ALTER TABLE "reel_scripts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reel_shots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"content_variant_id" uuid NOT NULL,
	"prompt_hash" text NOT NULL,
	"status" "reel_shot_status" DEFAULT 'PENDING' NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"provider_request_id" text,
	"prompt" text NOT NULL,
	"duration_seconds" integer NOT NULL,
	"resolution" text DEFAULT '720p' NOT NULL,
	"source_visual_asset_id" uuid,
	"source_frame_sha256" text,
	"storage_key" text,
	"width" integer,
	"height" integer,
	"bytes" integer,
	"sha256" text,
	"cost_usd" numeric(10, 4),
	"params" jsonb,
	"generation_run_id" uuid,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reel_shots_ready_check" CHECK ("reel_shots"."status" <> 'READY' or "reel_shots"."storage_key" is not null),
	CONSTRAINT "reel_shots_running_check" CHECK ("reel_shots"."status" <> 'RUNNING' or "reel_shots"."provider_request_id" is not null),
	CONSTRAINT "reel_shots_duration_check" CHECK ("reel_shots"."duration_seconds" between 1 and 30)
);
--> statement-breakpoint
ALTER TABLE "reel_shots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_variants" ADD COLUMN "current_reel_render_id" uuid;--> statement-breakpoint
ALTER TABLE "content_variants" ADD COLUMN "source_variant_id" uuid;--> statement-breakpoint
ALTER TABLE "reel_renders" ADD CONSTRAINT "reel_renders_content_variant_id_content_variants_id_fk" FOREIGN KEY ("content_variant_id") REFERENCES "public"."content_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_renders" ADD CONSTRAINT "reel_renders_reel_script_id_reel_scripts_id_fk" FOREIGN KEY ("reel_script_id") REFERENCES "public"."reel_scripts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_scripts" ADD CONSTRAINT "reel_scripts_content_variant_id_content_variants_id_fk" FOREIGN KEY ("content_variant_id") REFERENCES "public"."content_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_scripts" ADD CONSTRAINT "reel_scripts_generation_run_id_generation_runs_id_fk" FOREIGN KEY ("generation_run_id") REFERENCES "public"."generation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_shots" ADD CONSTRAINT "reel_shots_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_shots" ADD CONSTRAINT "reel_shots_content_variant_id_content_variants_id_fk" FOREIGN KEY ("content_variant_id") REFERENCES "public"."content_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_shots" ADD CONSTRAINT "reel_shots_source_visual_asset_id_visual_assets_id_fk" FOREIGN KEY ("source_visual_asset_id") REFERENCES "public"."visual_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_shots" ADD CONSTRAINT "reel_shots_generation_run_id_generation_runs_id_fk" FOREIGN KEY ("generation_run_id") REFERENCES "public"."generation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reel_shots_live_uq" ON "reel_shots" USING btree ("brand_id","prompt_hash") WHERE "reel_shots"."status" in ('PENDING', 'RUNNING', 'READY');--> statement-breakpoint
CREATE INDEX "reel_shots_variant_idx" ON "reel_shots" USING btree ("content_variant_id");--> statement-breakpoint
CREATE INDEX "reel_shots_status_idx" ON "reel_shots" USING btree ("status");--> statement-breakpoint
ALTER TABLE "content_variants" ADD CONSTRAINT "content_variants_current_reel_render_id_reel_renders_id_fk" FOREIGN KEY ("current_reel_render_id") REFERENCES "public"."reel_renders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_variants" ADD CONSTRAINT "content_variants_source_variant_id_content_variants_id_fk" FOREIGN KEY ("source_variant_id") REFERENCES "public"."content_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_variants" ADD CONSTRAINT "content_variants_source_variant_check" CHECK ("content_variants"."source_variant_id" is null or "content_variants"."format" = 'REEL');--> statement-breakpoint
-- Kept current by the trigger, like the other tables that have updated_at. set_updated_at()
-- comes from 0001_core.
CREATE TRIGGER reel_shots_set_updated_at BEFORE UPDATE ON "reel_shots"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
