CREATE TYPE "public"."attribution_event_type" AS ENUM('LEAD', 'SALE', 'REFUND');--> statement-breakpoint
CREATE TYPE "public"."snapshot_slot" AS ENUM('H2', 'D1', 'D3', 'D7', 'D28', 'MANUAL');--> statement-breakpoint
CREATE TABLE "account_metric_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"social_account_id" uuid NOT NULL,
	"metric_date" date NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"followers_count" integer,
	"follows" integer,
	"unfollows" integer,
	"reach" integer,
	"reach_followers" integer,
	"reach_non_followers" integer,
	"views" integer,
	"accounts_engaged" integer,
	"total_interactions" integer,
	"raw" jsonb NOT NULL,
	"api_version" text NOT NULL,
	CONSTRAINT "account_metric_snapshots_day_uq" UNIQUE("social_account_id","metric_date")
);
--> statement-breakpoint
ALTER TABLE "account_metric_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "attribution_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"type" "attribution_event_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"campaign_id" text,
	"offer_id" uuid,
	"quantity" integer DEFAULT 1 NOT NULL,
	"amount" numeric(12, 2),
	"currency" text,
	"source" text NOT NULL,
	"external_ref" text,
	"utm" jsonb,
	"import_batch_id" uuid,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attribution_events_source_ref_uq" UNIQUE("source","external_ref"),
	CONSTRAINT "attribution_events_source_check" CHECK ("attribution_events"."source" in ('MANUAL', 'CSV_IMPORT', 'WEBHOOK')),
	CONSTRAINT "attribution_events_quantity_check" CHECK ("attribution_events"."quantity" > 0),
	CONSTRAINT "attribution_events_currency_check" CHECK ("attribution_events"."currency" is null or "attribution_events"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "attribution_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "metric_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publication_id" uuid NOT NULL,
	"snapshot_slot" "snapshot_slot" NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"media_age_hours" numeric(8, 2) NOT NULL,
	"reach" integer,
	"views" integer,
	"likes" integer,
	"comments" integer,
	"saves" integer,
	"shares" integer,
	"total_interactions" integer,
	"profile_actions_json" jsonb,
	"follower_change" integer,
	"video_metrics_json" jsonb,
	"raw_metrics_json" jsonb NOT NULL,
	"api_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_snapshots_age_check" CHECK ("metric_snapshots"."media_age_hours" >= 0)
);
--> statement-breakpoint
ALTER TABLE "metric_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_metric_snapshots" ADD CONSTRAINT "account_metric_snapshots_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_events" ADD CONSTRAINT "attribution_events_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_events" ADD CONSTRAINT "attribution_events_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_events" ADD CONSTRAINT "attribution_events_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attribution_events_campaign_idx" ON "attribution_events" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_snapshots_slot_uq" ON "metric_snapshots" USING btree ("publication_id","snapshot_slot") WHERE "metric_snapshots"."snapshot_slot" <> 'MANUAL';--> statement-breakpoint
CREATE INDEX "metric_snapshots_publication_idx" ON "metric_snapshots" USING btree ("publication_id","media_age_hours");--> statement-breakpoint
-- Views (plan 11 §11.3), written by hand: Drizzle does not manage them. Everything that groups or
-- compares posts goes through them, so the rules (the D7 choice, the dayparts in the market's time
-- zone, dry runs excluded) live in one place. experiment_id and experiment_arm join the first view
-- with 0012 (M7-01), when the columns exist.
CREATE VIEW "v_publication_dimensions" AS
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
       cv.generation_version, cv.campaign_id
FROM publications p
JOIN content_variants cv ON cv.id = p.content_variant_id
JOIN master_ideas mi ON mi.id = cv.master_idea_id
JOIN markets m ON m.id = cv.market_id
WHERE p.status = 'PUBLISHED' AND p.dry_run = false;--> statement-breakpoint
-- One row per post: the snapshot closest to 168 h among those at least 72 h old (D7 when it
-- exists, else the D3 or a later one, flagged by is_exact_d7). Rates are per reach; a post with no
-- reach has null rates, never 0.
CREATE VIEW "v_publication_metrics_d7" AS
SELECT DISTINCT ON (s.publication_id)
       s.publication_id, s.snapshot_slot, s.media_age_hours,
       s.reach, s.views, s.likes, s.comments, s.saves, s.shares, s.total_interactions,
       s.saves::numeric / nullif(s.reach, 0) AS save_rate,
       s.shares::numeric / nullif(s.reach, 0) AS share_rate,
       s.comments::numeric / nullif(s.reach, 0) AS comment_rate,
       coalesce(s.total_interactions, s.likes + s.comments + s.saves + s.shares)::numeric
         / nullif(s.reach, 0) AS engagement_rate,
       (s.snapshot_slot = 'D7') AS is_exact_d7
FROM metric_snapshots s
WHERE s.media_age_hours >= 72
ORDER BY s.publication_id, abs(s.media_age_hours - 168), s.measured_at DESC;--> statement-breakpoint
-- Leads, sales and revenue (sales minus refunds) of each campaign; `quantity` counts, so an import
-- row of "3 leads" is three leads. Revenue is not split by currency (one currency per market).
CREATE VIEW "v_campaign_attribution" AS
SELECT cv.campaign_id, cv.market_id, cv.offer_id,
       coalesce(sum(a.quantity) FILTER (WHERE a.type = 'LEAD'), 0)::int AS leads,
       coalesce(sum(a.quantity) FILTER (WHERE a.type = 'SALE'), 0)::int AS sales,
       coalesce(sum(a.amount) FILTER (WHERE a.type = 'SALE'), 0)
         - coalesce(sum(a.amount) FILTER (WHERE a.type = 'REFUND'), 0) AS revenue
FROM content_variants cv
LEFT JOIN attribution_events a ON a.campaign_id = cv.campaign_id
WHERE cv.campaign_id IS NOT NULL
GROUP BY cv.campaign_id, cv.market_id, cv.offer_id;
