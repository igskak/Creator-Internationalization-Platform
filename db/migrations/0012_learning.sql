CREATE TYPE "public"."experiment_status" AS ENUM('DRAFT', 'RUNNING', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"hypothesis" text NOT NULL,
	"market_id" uuid,
	"dimension" text NOT NULL,
	"variant_a" text NOT NULL,
	"variant_b" text NOT NULL,
	"primary_metric" text DEFAULT 'save_rate' NOT NULL,
	"min_posts_per_arm" integer DEFAULT 5 NOT NULL,
	"status" "experiment_status" DEFAULT 'DRAFT' NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"notes" text,
	"visual_hypothesis_id" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiments_metric_check" CHECK ("experiments"."primary_metric" in ('save_rate', 'share_rate')),
	CONSTRAINT "experiments_min_posts_check" CHECK ("experiments"."min_posts_per_arm" between 2 and 100),
	CONSTRAINT "experiments_arms_check" CHECK ("experiments"."variant_a" <> "experiments"."variant_b")
);
--> statement-breakpoint
ALTER TABLE "experiments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "performance_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid,
	"window_start" date NOT NULL,
	"window_end" date NOT NULL,
	"summary_json" jsonb NOT NULL,
	"stats_json" jsonb NOT NULL,
	"min_sample" integer NOT NULL,
	"publications_count" integer NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "performance_summaries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_variants" ADD COLUMN "experiment_id" uuid;--> statement-breakpoint
ALTER TABLE "content_variants" ADD COLUMN "experiment_arm" text;--> statement-breakpoint
ALTER TABLE "master_ideas" ADD COLUMN "performance_summary_id" uuid;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_summaries" ADD CONSTRAINT "performance_summaries_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "experiments_market_status_idx" ON "experiments" USING btree ("market_id","status");--> statement-breakpoint
CREATE INDEX "performance_summaries_market_idx" ON "performance_summaries" USING btree ("market_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "content_variants" ADD CONSTRAINT "content_variants_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_ideas" ADD CONSTRAINT "master_ideas_performance_summary_id_performance_summaries_id_fk" FOREIGN KEY ("performance_summary_id") REFERENCES "public"."performance_summaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_variants_experiment_idx" ON "content_variants" USING btree ("experiment_id") WHERE "content_variants"."experiment_id" is not null;--> statement-breakpoint
ALTER TABLE "content_variants" ADD CONSTRAINT "content_variants_experiment_arm_check" CHECK (("content_variants"."experiment_id" is null) = ("content_variants"."experiment_arm" is null) and coalesce("content_variants"."experiment_arm" in ('A', 'B'), true));--> statement-breakpoint
-- Custom SQL (plan 04 §4.7 rule 2): the updated_at trigger of experiments, and the experiment
-- columns of v_publication_dimensions that 0011 left out until they existed. CREATE OR REPLACE
-- keeps the view's other columns as they are; the two new ones go at the end.
CREATE TRIGGER experiments_set_updated_at BEFORE UPDATE ON "experiments"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE OR REPLACE VIEW "v_publication_dimensions" AS
SELECT p.id AS publication_id, p.published_at, p.follower_count_at_publish,
       m.id AS market_id, m.code AS market_code,
       extract(isodow FROM p.published_at AT TIME ZONE m.timezone)::int AS weekday_local,
       CASE WHEN extract(hour FROM p.published_at AT TIME ZONE m.timezone) BETWEEN 6 AND 10 THEN 'MORNING'
            WHEN extract(hour FROM p.published_at AT TIME ZONE m.timezone) BETWEEN 11 AND 14 THEN 'MIDDAY'
            WHEN extract(hour FROM p.published_at AT TIME ZONE m.timezone) BETWEEN 15 AND 17 THEN 'AFTERNOON'
            WHEN extract(hour FROM p.published_at AT TIME ZONE m.timezone) BETWEEN 18 AND 21 THEN 'EVENING'
            ELSE 'NIGHT' END AS daypart_local,
       mi.id AS master_idea_id, mi.topic, mi.category, mi.angle, mi.commercial_intent, mi.product_id,
       cv.id AS variant_id, cv.format, cv.hook_type, cv.visual_style, cv.cta_type, cv.offer_id,
       cv.template_sequence, cv.template_sequence[1] AS first_template_id,
       (cv.content_length ->> 'slides')::int AS slide_count,
       (cv.content_length ->> 'captionChars')::int AS caption_chars,
       cv.generation_version, cv.campaign_id,
       cv.experiment_id, cv.experiment_arm
FROM publications p
JOIN content_variants cv ON cv.id = p.content_variant_id
JOIN master_ideas mi ON mi.id = cv.master_idea_id
JOIN markets m ON m.id = cv.market_id
WHERE p.status = 'PUBLISHED' AND p.dry_run = false;
