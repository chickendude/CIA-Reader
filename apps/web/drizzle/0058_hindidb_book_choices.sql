CREATE TABLE IF NOT EXISTS "hindi_context_choices" (
	"chapter_id" uuid NOT NULL,
	"source_occurrence_id" text NOT NULL,
	"source_start" integer NOT NULL,
	"source_end" integer NOT NULL,
	"selected_lemma_ids" jsonb NOT NULL,
	"candidate_lemma_ids" jsonb NOT NULL,
	"origin" text NOT NULL,
	"status" text NOT NULL,
	"metadata" jsonb NOT NULL,
	CONSTRAINT "hindi_context_choices_chapter_id_source_occurrence_id_pk" PRIMARY KEY("chapter_id","source_occurrence_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hindi_imported_books" (
	"source_version_id" text PRIMARY KEY NOT NULL,
	"text_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"metadata" jsonb NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hindi_context_choices" ADD CONSTRAINT "hindi_context_choices_chapter_id_text_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."text_chapters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hindi_imported_books" ADD CONSTRAINT "hindi_imported_books_text_id_texts_id_fk" FOREIGN KEY ("text_id") REFERENCES "public"."texts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
