CREATE TYPE "public"."translation_vote_value" AS ENUM('up', 'down');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "translation_votes" (
	"user_id" uuid NOT NULL,
	"translation_id" uuid NOT NULL,
	"value" "translation_vote_value" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "translation_votes_user_id_translation_id_pk" PRIMARY KEY("user_id","translation_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "translation_votes" ADD CONSTRAINT "translation_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "translation_votes" ADD CONSTRAINT "translation_votes_translation_id_translations_id_fk" FOREIGN KEY ("translation_id") REFERENCES "public"."translations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "translation_votes_translation_idx" ON "translation_votes" USING btree ("translation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "translation_votes_user_idx" ON "translation_votes" USING btree ("user_id");