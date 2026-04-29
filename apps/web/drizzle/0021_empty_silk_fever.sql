CREATE TYPE "public"."alignment_source" AS ENUM('manual', 'imported', 'whisper');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audio_alignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audio_file_id" uuid NOT NULL,
	"token_id" uuid NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"source" "alignment_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audio_alignments_audio_file_id_token_id_pk" PRIMARY KEY("audio_file_id","token_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audio_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text_id" uuid NOT NULL,
	"chapter_id" uuid,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"duration_ms" integer,
	"attribution" text,
	"license" text,
	"uploaded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audio_alignments" ADD CONSTRAINT "audio_alignments_audio_file_id_audio_files_id_fk" FOREIGN KEY ("audio_file_id") REFERENCES "public"."audio_files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audio_alignments" ADD CONSTRAINT "audio_alignments_token_id_text_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."text_tokens"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audio_files" ADD CONSTRAINT "audio_files_text_id_texts_id_fk" FOREIGN KEY ("text_id") REFERENCES "public"."texts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audio_files" ADD CONSTRAINT "audio_files_chapter_id_text_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."text_chapters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audio_files" ADD CONSTRAINT "audio_files_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audio_alignments_timeline_idx" ON "audio_alignments" USING btree ("audio_file_id","start_ms");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audio_files_text_idx" ON "audio_files" USING btree ("text_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audio_files_chapter_idx" ON "audio_files" USING btree ("chapter_id");