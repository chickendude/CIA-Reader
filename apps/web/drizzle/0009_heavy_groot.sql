CREATE TABLE IF NOT EXISTS "user_text_progress" (
	"user_id" uuid NOT NULL,
	"text_id" uuid NOT NULL,
	"last_chapter_idx" integer DEFAULT 0 NOT NULL,
	"last_token_idx" integer DEFAULT 0 NOT NULL,
	"pct_read" real DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_text_progress_user_id_text_id_pk" PRIMARY KEY("user_id","text_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_text_progress" ADD CONSTRAINT "user_text_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_text_progress" ADD CONSTRAINT "user_text_progress_text_id_texts_id_fk" FOREIGN KEY ("text_id") REFERENCES "public"."texts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_text_progress_user_idx" ON "user_text_progress" USING btree ("user_id","updated_at");