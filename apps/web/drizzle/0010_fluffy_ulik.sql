CREATE TABLE IF NOT EXISTS "form_lemma_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"language" "language" NOT NULL,
	"surface_nfc" text NOT NULL,
	"context_signature" text DEFAULT '' NOT NULL,
	"chosen_lemma_id" uuid NOT NULL,
	"vote_count" integer DEFAULT 1 NOT NULL,
	"promoted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"promoted_by" uuid,
	"note" text,
	CONSTRAINT "form_lemma_overrides_lang_surface_ctx_uq" UNIQUE("language","surface_nfc","context_signature")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "form_lemma_overrides" ADD CONSTRAINT "form_lemma_overrides_chosen_lemma_id_lemmas_id_fk" FOREIGN KEY ("chosen_lemma_id") REFERENCES "public"."lemmas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "form_lemma_overrides" ADD CONSTRAINT "form_lemma_overrides_promoted_by_users_id_fk" FOREIGN KEY ("promoted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_lemma_overrides_lookup_idx" ON "form_lemma_overrides" USING btree ("language","surface_nfc");