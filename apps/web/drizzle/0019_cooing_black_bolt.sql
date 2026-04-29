CREATE TYPE "public"."collection_kind" AS ENUM('chapter_book', 'course', 'anthology');--> statement-breakpoint
CREATE TYPE "public"."collection_visibility" AS ENUM('private', 'shared', 'official');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collection_items" (
	"collection_id" uuid NOT NULL,
	"text_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_items_collection_id_text_id_pk" PRIMARY KEY("collection_id","text_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid,
	"language" "language" NOT NULL,
	"kind" "collection_kind" DEFAULT 'chapter_book' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"cover_url" text,
	"visibility" "collection_visibility" DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_text_id_texts_id_fk" FOREIGN KEY ("text_id") REFERENCES "public"."texts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "collections" ADD CONSTRAINT "collections_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collection_items_order_idx" ON "collection_items" USING btree ("collection_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collections_owner_idx" ON "collections" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collections_visibility_idx" ON "collections" USING btree ("visibility","language");