-- 0010 (M8-09): an approved version of a Reel points at its reel render instead of a carousel
-- render. Exactly one of the two is set. Existing rows are carousels and keep carousel_render_id.

ALTER TABLE "content_variant_versions" ALTER COLUMN "carousel_render_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "content_variant_versions" ADD COLUMN "reel_render_id" uuid;--> statement-breakpoint
ALTER TABLE "content_variant_versions" ADD CONSTRAINT "content_variant_versions_reel_render_id_reel_renders_id_fk" FOREIGN KEY ("reel_render_id") REFERENCES "public"."reel_renders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_variant_versions" ADD CONSTRAINT "content_variant_versions_render_check" CHECK (("content_variant_versions"."carousel_render_id" is null) <> ("content_variant_versions"."reel_render_id" is null));