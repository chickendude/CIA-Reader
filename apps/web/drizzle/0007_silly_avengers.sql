CREATE TYPE "public"."nlp_job_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nlp_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text_id" uuid NOT NULL,
	"status" "nlp_job_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "nlp_jobs" ADD CONSTRAINT "nlp_jobs_text_id_texts_id_fk" FOREIGN KEY ("text_id") REFERENCES "public"."texts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nlp_jobs_text_idx" ON "nlp_jobs" USING btree ("text_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nlp_jobs_status_idx" ON "nlp_jobs" USING btree ("status");