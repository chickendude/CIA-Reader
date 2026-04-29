CREATE TYPE "public"."parse_report_status" AS ENUM('open', 'triaged', 'resolved', 'rejected', 'duplicate', 'deferred');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "parse_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id" uuid,
	"language" "language" NOT NULL,
	"surface_nfc" text NOT NULL,
	"context_signature" text DEFAULT '' NOT NULL,
	"original_candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"corrected_lemma_id" uuid,
	"correction_type" "token_correction_type" NOT NULL,
	"reporter_id" uuid,
	"note" text,
	"status" "parse_report_status" DEFAULT 'open' NOT NULL,
	"assigned_reviewer_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"duplicate_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "parse_reports" ADD CONSTRAINT "parse_reports_token_id_text_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."text_tokens"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "parse_reports" ADD CONSTRAINT "parse_reports_corrected_lemma_id_lemmas_id_fk" FOREIGN KEY ("corrected_lemma_id") REFERENCES "public"."lemmas"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "parse_reports" ADD CONSTRAINT "parse_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "parse_reports" ADD CONSTRAINT "parse_reports_assigned_reviewer_id_users_id_fk" FOREIGN KEY ("assigned_reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "parse_reports_lang_status_idx" ON "parse_reports" USING btree ("language","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "parse_reports_dedup_idx" ON "parse_reports" USING btree ("language","surface_nfc","context_signature","corrected_lemma_id");