CREATE TYPE "public"."commercial_intent" AS ENUM('NONE', 'LEAD_MAGNET', 'PRODUCT_SALE', 'NURTURE');--> statement-breakpoint
CREATE TYPE "public"."critic_verdict" AS ENUM('PASS', 'REQUEST_REWRITE', 'FLAG_FOR_HUMAN');--> statement-breakpoint
CREATE TYPE "public"."idea_status" AS ENUM('PROPOSED', 'ACCEPTED', 'REJECTED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."variant_status" AS ENUM('DRAFT', 'GENERATING', 'READY_FOR_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "content_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"master_idea_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"format" "content_format" DEFAULT 'CAROUSEL' NOT NULL,
	"status" "variant_status" DEFAULT 'DRAFT' NOT NULL,
	"hook" text,
	"hook_type" text,
	"caption" text,
	"cta" text,
	"cta_type" text,
	"cta_json" jsonb,
	"hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
	"slides_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visual_brief_json" jsonb,
	"market_brief_json" jsonb,
	"visual_style" text,
	"template_sequence" text[] DEFAULT '{}'::text[] NOT NULL,
	"offer_id" uuid,
	"campaign_id" text,
	"utm_json" jsonb,
	"content_length" jsonb,
	"generation_version" text,
	"generation_config" jsonb,
	"pipeline_state" jsonb,
	"quality_score" numeric(4, 2),
	"critic_verdict" "critic_verdict",
	"critic_report" jsonb,
	"differentiation_report" jsonb,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"last_error" jsonb,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_variants_campaignId_unique" UNIQUE("campaign_id")
);
--> statement-breakpoint
ALTER TABLE "content_variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "master_idea_knowledge" (
	"master_idea_id" uuid NOT NULL,
	"knowledge_item_id" uuid NOT NULL,
	"knowledge_version" integer NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "master_idea_knowledge_master_idea_id_knowledge_item_id_pk" PRIMARY KEY("master_idea_id","knowledge_item_id"),
	CONSTRAINT "master_idea_knowledge_role_check" CHECK ("master_idea_knowledge"."role" in ('PRIMARY', 'SUPPORTING'))
);
--> statement-breakpoint
ALTER TABLE "master_idea_knowledge" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "master_ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"category" text NOT NULL,
	"angle" text NOT NULL,
	"core_message" text NOT NULL,
	"evidence_summary" text DEFAULT '' NOT NULL,
	"recommended_format" "content_format" DEFAULT 'CAROUSEL' NOT NULL,
	"commercial_intent" "commercial_intent" DEFAULT 'NONE' NOT NULL,
	"product_id" uuid,
	"status" "idea_status" DEFAULT 'PROPOSED' NOT NULL,
	"origin" text NOT NULL,
	"rationale" text,
	"rejected_reason" text,
	"generation_run_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "master_ideas_origin_check" CHECK ("master_ideas"."origin" in ('AI_GENERATED', 'MANUAL'))
);
--> statement-breakpoint
ALTER TABLE "master_ideas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"price" numeric(12, 2),
	"currency" char(3) NOT NULL,
	"landing_url" text,
	"default_keyword" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offers_type_check" CHECK ("offers"."type" in ('LEAD_MAGNET', 'PAID_PRODUCT', 'BUNDLE')),
	CONSTRAINT "offers_status_check" CHECK ("offers"."status" in ('DRAFT', 'ACTIVE', 'PAUSED', 'RETIRED'))
);
--> statement-breakpoint
ALTER TABLE "offers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"description" text,
	"original_language" text NOT NULL,
	"source_asset_id" uuid,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_code_unique" UNIQUE("code"),
	CONSTRAINT "products_type_check" CHECK ("products"."type" in ('GUIDE', 'RECIPE_COLLECTION', 'COURSE', 'BUNDLE', 'OTHER')),
	CONSTRAINT "products_status_check" CHECK ("products"."status" in ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "voice_examples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid,
	"kind" text NOT NULL,
	"before_text" text,
	"after_text" text,
	"note" text,
	"language" text,
	"source" text NOT NULL,
	"review_event_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_examples_kind_check" CHECK ("voice_examples"."kind" in ('EDIT_PAIR', 'EXEMPLAR', 'RULE')),
	CONSTRAINT "voice_examples_source_check" CHECK ("voice_examples"."source" in ('SEED', 'REVIEW_EVENT'))
);
--> statement-breakpoint
ALTER TABLE "voice_examples" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD COLUMN "master_idea_id" uuid;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD COLUMN "content_variant_id" uuid;--> statement-breakpoint
ALTER TABLE "content_variants" ADD CONSTRAINT "content_variants_master_idea_id_master_ideas_id_fk" FOREIGN KEY ("master_idea_id") REFERENCES "public"."master_ideas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_variants" ADD CONSTRAINT "content_variants_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_variants" ADD CONSTRAINT "content_variants_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_idea_knowledge" ADD CONSTRAINT "master_idea_knowledge_master_idea_id_master_ideas_id_fk" FOREIGN KEY ("master_idea_id") REFERENCES "public"."master_ideas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_idea_knowledge" ADD CONSTRAINT "master_idea_knowledge_knowledge_item_id_knowledge_items_id_fk" FOREIGN KEY ("knowledge_item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_ideas" ADD CONSTRAINT "master_ideas_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_ideas" ADD CONSTRAINT "master_ideas_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_ideas" ADD CONSTRAINT "master_ideas_generation_run_id_generation_runs_id_fk" FOREIGN KEY ("generation_run_id") REFERENCES "public"."generation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_ideas" ADD CONSTRAINT "master_ideas_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_source_asset_id_source_assets_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "public"."source_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_examples" ADD CONSTRAINT "voice_examples_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_variants_active_uq" ON "content_variants" USING btree ("master_idea_id","market_id","format") WHERE "content_variants"."status" <> 'REJECTED';--> statement-breakpoint
CREATE INDEX "content_variants_market_status_idx" ON "content_variants" USING btree ("market_id","status");--> statement-breakpoint
CREATE INDEX "content_variants_status_updated_idx" ON "content_variants" USING btree ("status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "master_ideas_status_idx" ON "master_ideas" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "offers_market_status_idx" ON "offers" USING btree ("market_id","status");--> statement-breakpoint
CREATE INDEX "generation_runs_variant_idx" ON "generation_runs" USING btree ("content_variant_id");--> statement-breakpoint
-- ---------------------------------------------------------------------------------------------
-- Custom SQL (plan 04 §4.7 rule 2): foreign keys from generation_runs to the new tables. They are
-- not declared in the Drizzle schema because content.ts already imports knowledge.ts (import cycle
-- rule); the columns themselves are declared in knowledge.ts. Same pattern as voice_examples.review_event_id.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_master_idea_id_master_ideas_id_fk" FOREIGN KEY ("master_idea_id") REFERENCES "public"."master_ideas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_content_variant_id_content_variants_id_fk" FOREIGN KEY ("content_variant_id") REFERENCES "public"."content_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- ---------------------------------------------------------------------------------------------
-- Custom SQL (plan 04 §4.7 rule 2): updated_at triggers for the tables of this migration that
-- have the column. set_updated_at() comes from 0001_core.
-- ---------------------------------------------------------------------------------------------
CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON "products"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER offers_set_updated_at BEFORE UPDATE ON "offers"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER master_ideas_set_updated_at BEFORE UPDATE ON "master_ideas"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER content_variants_set_updated_at BEFORE UPDATE ON "content_variants"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER voice_examples_set_updated_at BEFORE UPDATE ON "voice_examples"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
