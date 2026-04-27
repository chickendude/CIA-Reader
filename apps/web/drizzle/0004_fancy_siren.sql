CREATE TYPE "public"."lemma_edit_change_type" AS ENUM('lemma_update', 'lemma_unlock', 'lemma_lock', 'translation_insert', 'translation_update', 'translation_hide', 'translation_unhide', 'form_insert', 'form_delete');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "curator_languages" (
	"user_id" uuid NOT NULL,
	"language" "language" NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "curator_languages_user_id_language_pk" PRIMARY KEY("user_id","language")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lemma_edit_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lemma_id" uuid NOT NULL,
	"editor_id" uuid,
	"change_type" "lemma_edit_change_type" NOT NULL,
	"change" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "curator_languages" ADD CONSTRAINT "curator_languages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "curator_languages" ADD CONSTRAINT "curator_languages_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lemma_edit_history" ADD CONSTRAINT "lemma_edit_history_lemma_id_lemmas_id_fk" FOREIGN KEY ("lemma_id") REFERENCES "public"."lemmas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lemma_edit_history" ADD CONSTRAINT "lemma_edit_history_editor_id_users_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "curator_languages_user_idx" ON "curator_languages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lemma_edit_history_lemma_idx" ON "lemma_edit_history" USING btree ("lemma_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lemma_edit_history_editor_idx" ON "lemma_edit_history" USING btree ("editor_id");