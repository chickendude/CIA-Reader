ALTER TYPE "public"."translation_source" ADD VALUE 'nlp';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "phrase_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"language" "language" NOT NULL,
	"surface_normalised" text NOT NULL,
	"tokens" jsonb NOT NULL,
	"pattern_id" text NOT NULL,
	"chapter_id" uuid NOT NULL,
	"promoted_at" timestamp with time zone,
	"promoted_phrase_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phrase_proposals_occurrence_uq" UNIQUE("chapter_id","surface_normalised","pattern_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "phrase_proposals" ADD CONSTRAINT "phrase_proposals_chapter_id_text_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."text_chapters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "phrase_proposals" ADD CONSTRAINT "phrase_proposals_promoted_phrase_id_phrases_id_fk" FOREIGN KEY ("promoted_phrase_id") REFERENCES "public"."phrases"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phrase_proposals_promotion_lookup_idx" ON "phrase_proposals" USING btree ("language","surface_normalised");