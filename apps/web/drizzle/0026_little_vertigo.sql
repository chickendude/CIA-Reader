CREATE TYPE "public"."translation_target_type" AS ENUM('lemma', 'phrase');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "phrase_tokens" (
	"phrase_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"surface" text NOT NULL,
	"lemma_id" uuid,
	CONSTRAINT "phrase_tokens_phrase_id_position_pk" PRIMARY KEY("phrase_id","position")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "phrases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"language" "language" NOT NULL,
	"surface_normalised" text NOT NULL,
	"pos" text,
	"gloss_default" text,
	"frequency_rank" integer,
	"source" "translation_source" NOT NULL,
	"source_attribution" text,
	"source_id" text,
	"curator_locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_known_phrases" (
	"user_id" uuid NOT NULL,
	"phrase_id" uuid NOT NULL,
	"status" "known_lemma_status" DEFAULT 'learning' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_known_phrases_user_id_phrase_id_pk" PRIMARY KEY("user_id","phrase_id")
);
--> statement-breakpoint
ALTER TABLE "translations" ALTER COLUMN "lemma_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "translations" ADD COLUMN "target_type" "translation_target_type" DEFAULT 'lemma' NOT NULL;--> statement-breakpoint
-- T-14.1: target_id is added nullable, backfilled from lemma_id for
-- every legacy row (target_type='lemma'), then made NOT NULL. This
-- ordering is required so the migration is safe to apply against
-- a table that already has rows.
ALTER TABLE "translations" ADD COLUMN "target_id" uuid;--> statement-breakpoint
UPDATE "translations" SET "target_id" = "lemma_id" WHERE "target_id" IS NULL;--> statement-breakpoint
ALTER TABLE "translations" ALTER COLUMN "target_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_languages" ADD COLUMN "known_phrases_count_cache" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "phrase_tokens" ADD CONSTRAINT "phrase_tokens_phrase_id_phrases_id_fk" FOREIGN KEY ("phrase_id") REFERENCES "public"."phrases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "phrase_tokens" ADD CONSTRAINT "phrase_tokens_lemma_id_lemmas_id_fk" FOREIGN KEY ("lemma_id") REFERENCES "public"."lemmas"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_known_phrases" ADD CONSTRAINT "user_known_phrases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_known_phrases" ADD CONSTRAINT "user_known_phrases_phrase_id_phrases_id_fk" FOREIGN KEY ("phrase_id") REFERENCES "public"."phrases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phrase_tokens_surface_idx" ON "phrase_tokens" USING btree ("surface");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phrases_language_surface_idx" ON "phrases" USING btree ("language","surface_normalised");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phrases_language_idx" ON "phrases" USING btree ("language");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phrases_language_frequency_idx" ON "phrases" USING btree ("language","frequency_rank");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phrases_source_lookup_idx" ON "phrases" USING btree ("language","source","source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_known_phrases_user_idx" ON "user_known_phrases" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "translations_target_idx" ON "translations" USING btree ("target_type","target_id","source");