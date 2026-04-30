CREATE TABLE IF NOT EXISTS "phrase_chapter_spans" (
	"chapter_id" uuid NOT NULL,
	"phrase_id" uuid NOT NULL,
	"start_token_idx" integer NOT NULL,
	"end_token_idx" integer NOT NULL,
	CONSTRAINT "phrase_chapter_spans_chapter_id_start_token_idx_phrase_id_pk" PRIMARY KEY("chapter_id","start_token_idx","phrase_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "phrase_chapter_spans" ADD CONSTRAINT "phrase_chapter_spans_chapter_id_text_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."text_chapters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "phrase_chapter_spans" ADD CONSTRAINT "phrase_chapter_spans_phrase_id_phrases_id_fk" FOREIGN KEY ("phrase_id") REFERENCES "public"."phrases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phrase_chapter_spans_chapter_idx" ON "phrase_chapter_spans" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phrase_chapter_spans_phrase_idx" ON "phrase_chapter_spans" USING btree ("phrase_id");