ALTER TABLE "dictionary_imports" ADD COLUMN "triggered_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "dictionary_imports" ADD COLUMN "status" text DEFAULT 'succeeded' NOT NULL;--> statement-breakpoint
ALTER TABLE "dictionary_imports" ADD COLUMN "error_message" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dictionary_imports" ADD CONSTRAINT "dictionary_imports_triggered_by_user_id_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dictionary_imports_source_latest_idx" ON "dictionary_imports" USING btree ("source_name","run_at");