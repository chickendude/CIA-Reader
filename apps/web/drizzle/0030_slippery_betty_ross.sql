CREATE TYPE "public"."translation_report_reason" AS ENUM('spam', 'incorrect', 'offensive', 'duplicate', 'other');--> statement-breakpoint
CREATE TYPE "public"."translation_report_status" AS ENUM('open', 'resolved_hidden', 'resolved_kept', 'dismissed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "translation_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"translation_id" uuid NOT NULL,
	"reporter_id" uuid,
	"reason" "translation_report_reason" NOT NULL,
	"note" text,
	"status" "translation_report_status" DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "translation_reports_reporter_translation_uq" UNIQUE("reporter_id","translation_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "translation_reports" ADD CONSTRAINT "translation_reports_translation_id_translations_id_fk" FOREIGN KEY ("translation_id") REFERENCES "public"."translations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "translation_reports" ADD CONSTRAINT "translation_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "translation_reports" ADD CONSTRAINT "translation_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "translation_reports_status_idx" ON "translation_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "translation_reports_translation_idx" ON "translation_reports" USING btree ("translation_id");