CREATE TYPE "public"."known_lemma_status" AS ENUM('unknown', 'learning', 'known', 'ignored');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "text_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"surface" text NOT NULL,
	"lemma_id" uuid,
	"lemma_candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_ambiguous" boolean DEFAULT false NOT NULL,
	"is_oov" boolean DEFAULT false NOT NULL,
	"is_word" boolean DEFAULT true NOT NULL,
	"sentence_idx" integer DEFAULT 0 NOT NULL,
	"romanization" text,
	CONSTRAINT "text_tokens_chapter_idx_uq" UNIQUE("chapter_id","idx")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_known_lemmas" (
	"user_id" uuid NOT NULL,
	"lemma_id" uuid NOT NULL,
	"status" "known_lemma_status" DEFAULT 'learning' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_known_lemmas_user_id_lemma_id_pk" PRIMARY KEY("user_id","lemma_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "text_tokens" ADD CONSTRAINT "text_tokens_chapter_id_text_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."text_chapters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "text_tokens" ADD CONSTRAINT "text_tokens_lemma_id_lemmas_id_fk" FOREIGN KEY ("lemma_id") REFERENCES "public"."lemmas"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_known_lemmas" ADD CONSTRAINT "user_known_lemmas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_known_lemmas" ADD CONSTRAINT "user_known_lemmas_lemma_id_lemmas_id_fk" FOREIGN KEY ("lemma_id") REFERENCES "public"."lemmas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "text_tokens_chapter_scan_idx" ON "text_tokens" USING btree ("chapter_id","idx");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "text_tokens_lemma_idx" ON "text_tokens" USING btree ("lemma_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_known_lemmas_user_idx" ON "user_known_lemmas" USING btree ("user_id","status");