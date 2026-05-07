CREATE TYPE "public"."lemma_form_source" AS ENUM('import', 'pipeline', 'curator', 'generator');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grammar_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feat_key" text NOT NULL,
	"feat_value" text NOT NULL,
	"pos_scope" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"short_label" text NOT NULL,
	"long_label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "grammar_features_key_value_uq" UNIQUE("feat_key","feat_value")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "paradigm_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paradigm_id" uuid NOT NULL,
	"slot_key" text NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"suffix" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "paradigm_slots_paradigm_key_uq" UNIQUE("paradigm_id","slot_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "paradigms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"language" "language" NOT NULL,
	"pos" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paradigms_language_pos_name_uq" UNIQUE("language","pos","name")
);
--> statement-breakpoint
ALTER TABLE "lemma_forms" ADD COLUMN "created_by" "lemma_form_source" DEFAULT 'import' NOT NULL;--> statement-breakpoint
ALTER TABLE "lemma_forms" ADD COLUMN "paradigm_slot_id" uuid;--> statement-breakpoint
ALTER TABLE "lemma_forms" ADD COLUMN "quarantined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lemma_forms" ADD COLUMN "quarantine_reason" text;--> statement-breakpoint
ALTER TABLE "lemmas" ADD COLUMN "paradigm_id" uuid;--> statement-breakpoint
ALTER TABLE "lemmas" ADD COLUMN "stem" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "paradigm_slots" ADD CONSTRAINT "paradigm_slots_paradigm_id_paradigms_id_fk" FOREIGN KEY ("paradigm_id") REFERENCES "public"."paradigms"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grammar_features_key_idx" ON "grammar_features" USING btree ("feat_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "paradigm_slots_paradigm_idx" ON "paradigm_slots" USING btree ("paradigm_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "paradigms_language_pos_idx" ON "paradigms" USING btree ("language","pos");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lemma_forms" ADD CONSTRAINT "lemma_forms_paradigm_slot_id_paradigm_slots_id_fk" FOREIGN KEY ("paradigm_slot_id") REFERENCES "public"."paradigm_slots"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lemmas" ADD CONSTRAINT "lemmas_paradigm_id_paradigms_id_fk" FOREIGN KEY ("paradigm_id") REFERENCES "public"."paradigms"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lemma_forms_surface_lookup_idx" ON "lemma_forms" USING btree ("surface","lemma_id") WHERE quarantined_at IS NULL;