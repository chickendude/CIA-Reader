CREATE TYPE "public"."text_share_permission" AS ENUM('read');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "text_shares" (
	"text_id" uuid NOT NULL,
	"shared_with_user_id" uuid NOT NULL,
	"permission" "text_share_permission" DEFAULT 'read' NOT NULL,
	"granted_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "text_shares_text_id_shared_with_user_id_pk" PRIMARY KEY("text_id","shared_with_user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "text_shares" ADD CONSTRAINT "text_shares_text_id_texts_id_fk" FOREIGN KEY ("text_id") REFERENCES "public"."texts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "text_shares" ADD CONSTRAINT "text_shares_shared_with_user_id_users_id_fk" FOREIGN KEY ("shared_with_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "text_shares" ADD CONSTRAINT "text_shares_granted_by_id_users_id_fk" FOREIGN KEY ("granted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "text_shares_recipient_idx" ON "text_shares" USING btree ("shared_with_user_id");