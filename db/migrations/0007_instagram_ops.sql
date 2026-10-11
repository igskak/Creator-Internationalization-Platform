CREATE TABLE "integration_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"integration" text NOT NULL,
	"social_account_id" uuid,
	"severity" text NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"details" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "integration_events_severity_check" CHECK ("integration_events"."severity" in ('INFO', 'WARN', 'ERROR'))
);
--> statement-breakpoint
ALTER TABLE "integration_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "publish_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publication_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"step" text NOT NULL,
	"endpoint" text NOT NULL,
	"request" jsonb,
	"http_status" integer,
	"response" jsonb,
	"outcome" text NOT NULL,
	"error_code" text,
	"error_subcode" text,
	"fbtrace_id" text,
	"duration_ms" integer,
	"trigger_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publish_attempts_outcome_check" CHECK ("publish_attempts"."outcome" in ('OK', 'TRANSIENT_ERROR', 'PERMANENT_ERROR', 'AMBIGUOUS'))
);
--> statement-breakpoint
ALTER TABLE "publish_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_attempts" ADD CONSTRAINT "publish_attempts_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_events_open_idx" ON "integration_events" USING btree ("integration","occurred_at" DESC NULLS LAST) WHERE "integration_events"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "publish_attempts_pub_idx" ON "publish_attempts" USING btree ("publication_id","created_at");