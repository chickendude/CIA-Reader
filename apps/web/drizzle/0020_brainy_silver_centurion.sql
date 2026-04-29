CREATE TABLE IF NOT EXISTS "collection_shares" (
	"collection_id" uuid NOT NULL,
	"shared_with_user_id" uuid NOT NULL,
	"granted_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_shares_collection_id_shared_with_user_id_pk" PRIMARY KEY("collection_id","shared_with_user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "collection_shares" ADD CONSTRAINT "collection_shares_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "collection_shares" ADD CONSTRAINT "collection_shares_shared_with_user_id_users_id_fk" FOREIGN KEY ("shared_with_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "collection_shares" ADD CONSTRAINT "collection_shares_granted_by_id_users_id_fk" FOREIGN KEY ("granted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collection_shares_recipient_idx" ON "collection_shares" USING btree ("shared_with_user_id");