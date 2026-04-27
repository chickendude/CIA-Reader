CREATE TYPE "public"."text_source_type" AS ENUM('paste', 'txt', 'epub');--> statement-breakpoint
CREATE TYPE "public"."text_status" AS ENUM('pending', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."text_visibility" AS ENUM('private', 'shared', 'official');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "text_chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "text_chapters_text_idx_uq" UNIQUE("text_id","idx")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "texts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid,
	"language" "language" NOT NULL,
	"title" text NOT NULL,
	"source_type" "text_source_type" NOT NULL,
	"status" "text_status" DEFAULT 'pending' NOT NULL,
	"visibility" "text_visibility" DEFAULT 'private' NOT NULL,
	"status_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "text_chapters" ADD CONSTRAINT "text_chapters_text_id_texts_id_fk" FOREIGN KEY ("text_id") REFERENCES "public"."texts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "texts" ADD CONSTRAINT "texts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "text_chapters_text_idx" ON "text_chapters" USING btree ("text_id","idx");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "texts_owner_idx" ON "texts" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "texts_visibility_idx" ON "texts" USING btree ("visibility","language");