CREATE TYPE "public"."scan_ocr_status" AS ENUM('pending', 'ok', 'failed');--> statement-breakpoint
CREATE TYPE "public"."transcription_issue_status" AS ENUM('open', 'resolved');--> statement-breakpoint
ALTER TYPE "public"."lemma_edit_change_type" ADD VALUE 'lemma_create';--> statement-breakpoint
ALTER TYPE "public"."lemma_edit_change_type" ADD VALUE 'transcription_verify';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lemma_scan_refs" (
	"lemma_id" uuid PRIMARY KEY NOT NULL,
	"scan_page_id" uuid NOT NULL,
	"crop" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scan_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"volume_id" uuid NOT NULL,
	"pdf_page_index" integer NOT NULL,
	"printed_page" integer,
	"image_key" text NOT NULL,
	"image_mime" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"ocr_status" "scan_ocr_status" DEFAULT 'pending' NOT NULL,
	"ocr_engine" text,
	"ocr_text" text,
	"ocr_words" jsonb,
	"ocr_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_pages_volume_page_uq" UNIQUE("volume_id","pdf_page_index")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scan_volumes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dictionary_slug" text NOT NULL,
	"volume_number" integer DEFAULT 1 NOT NULL,
	"source_url" text NOT NULL,
	"source_note" text,
	"page_count" integer NOT NULL,
	"page_offset" integer DEFAULT 0 NOT NULL,
	"printed_page_start" integer,
	"printed_page_end" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_volumes_slug_volume_uq" UNIQUE("dictionary_slug","volume_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transcription_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dictionary_slug" text NOT NULL,
	"lemma_id" uuid,
	"scan_page_id" uuid,
	"note" text NOT NULL,
	"status" "transcription_issue_status" DEFAULT 'open' NOT NULL,
	"created_by" uuid,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lemma_scan_refs" ADD CONSTRAINT "lemma_scan_refs_lemma_id_lemmas_id_fk" FOREIGN KEY ("lemma_id") REFERENCES "public"."lemmas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lemma_scan_refs" ADD CONSTRAINT "lemma_scan_refs_scan_page_id_scan_pages_id_fk" FOREIGN KEY ("scan_page_id") REFERENCES "public"."scan_pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lemma_scan_refs" ADD CONSTRAINT "lemma_scan_refs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scan_pages" ADD CONSTRAINT "scan_pages_volume_id_scan_volumes_id_fk" FOREIGN KEY ("volume_id") REFERENCES "public"."scan_volumes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transcription_issues" ADD CONSTRAINT "transcription_issues_lemma_id_lemmas_id_fk" FOREIGN KEY ("lemma_id") REFERENCES "public"."lemmas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transcription_issues" ADD CONSTRAINT "transcription_issues_scan_page_id_scan_pages_id_fk" FOREIGN KEY ("scan_page_id") REFERENCES "public"."scan_pages"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transcription_issues" ADD CONSTRAINT "transcription_issues_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transcription_issues" ADD CONSTRAINT "transcription_issues_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lemma_scan_refs_page_idx" ON "lemma_scan_refs" USING btree ("scan_page_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scan_pages_volume_printed_idx" ON "scan_pages" USING btree ("volume_id","printed_page");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transcription_issues_slug_status_idx" ON "transcription_issues" USING btree ("dictionary_slug","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transcription_issues_lemma_idx" ON "transcription_issues" USING btree ("lemma_id");