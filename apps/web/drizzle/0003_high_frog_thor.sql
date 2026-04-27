CREATE TYPE "public"."translation_source" AS ENUM('official_dictionary', 'curator', 'user');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dictionary_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_name" text NOT NULL,
	"language" "language" NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lemmas_created" integer DEFAULT 0 NOT NULL,
	"lemmas_updated" integer DEFAULT 0 NOT NULL,
	"lemmas_skipped_curator_locked" integer DEFAULT 0 NOT NULL,
	"translations_created" integer DEFAULT 0 NOT NULL,
	"translations_updated" integer DEFAULT 0 NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lemma_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lemma_id" uuid NOT NULL,
	"surface" text NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"romanization" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lemmas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"language" "language" NOT NULL,
	"headword" text NOT NULL,
	"pos" text NOT NULL,
	"script" text NOT NULL,
	"gloss_default" text,
	"frequency_rank" integer,
	"source" "translation_source" NOT NULL,
	"source_attribution" text,
	"source_id" text,
	"curator_locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lemmas_language_headword_pos_uq" UNIQUE("language","headword","pos")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lemma_id" uuid NOT NULL,
	"source" "translation_source" NOT NULL,
	"submitted_by" uuid,
	"parent_translation_id" uuid,
	"body" text NOT NULL,
	"target_language" text DEFAULT 'en' NOT NULL,
	"source_attribution" text,
	"source_id" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lemma_forms" ADD CONSTRAINT "lemma_forms_lemma_id_lemmas_id_fk" FOREIGN KEY ("lemma_id") REFERENCES "public"."lemmas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "translations" ADD CONSTRAINT "translations_lemma_id_lemmas_id_fk" FOREIGN KEY ("lemma_id") REFERENCES "public"."lemmas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "translations" ADD CONSTRAINT "translations_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "translations" ADD CONSTRAINT "translations_parent_translation_id_translations_id_fk" FOREIGN KEY ("parent_translation_id") REFERENCES "public"."translations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dictionary_imports_language_idx" ON "dictionary_imports" USING btree ("language","run_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lemma_forms_lemma_idx" ON "lemma_forms" USING btree ("lemma_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lemma_forms_surface_idx" ON "lemma_forms" USING btree ("surface");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lemmas_language_idx" ON "lemmas" USING btree ("language");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lemmas_language_frequency_idx" ON "lemmas" USING btree ("language","frequency_rank");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lemmas_source_lookup_idx" ON "lemmas" USING btree ("language","source","source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "translations_lemma_idx" ON "translations" USING btree ("lemma_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "translations_submitted_by_idx" ON "translations" USING btree ("submitted_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "translations_source_lookup_idx" ON "translations" USING btree ("lemma_id","source","source_id");