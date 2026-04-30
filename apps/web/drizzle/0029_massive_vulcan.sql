CREATE TABLE IF NOT EXISTS "api_rate_limit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_rate_limit_events" ADD CONSTRAINT "api_rate_limit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_rate_limit_events_subject_window_idx" ON "api_rate_limit_events" USING btree ("scope","subject_type","subject_hash","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_rate_limit_events_user_idx" ON "api_rate_limit_events" USING btree ("user_id");