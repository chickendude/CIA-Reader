ALTER TABLE "user_known_lemmas" ADD COLUMN "mined_sentence" text;--> statement-breakpoint
ALTER TABLE "user_known_lemmas" ADD COLUMN "mined_chapter_id" uuid;--> statement-breakpoint
ALTER TABLE "user_known_lemmas" ADD COLUMN "mined_token_idx" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_known_lemmas" ADD CONSTRAINT "user_known_lemmas_mined_chapter_id_text_chapters_id_fk" FOREIGN KEY ("mined_chapter_id") REFERENCES "public"."text_chapters"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
