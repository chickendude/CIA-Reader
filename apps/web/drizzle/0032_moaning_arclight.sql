ALTER TYPE "public"."lemma_edit_change_type" ADD VALUE 'phrase_update';--> statement-breakpoint
ALTER TYPE "public"."lemma_edit_change_type" ADD VALUE 'phrase_lock';--> statement-breakpoint
ALTER TYPE "public"."lemma_edit_change_type" ADD VALUE 'phrase_unlock';--> statement-breakpoint
ALTER TYPE "public"."lemma_edit_change_type" ADD VALUE 'phrase_hide';--> statement-breakpoint
ALTER TYPE "public"."lemma_edit_change_type" ADD VALUE 'phrase_unhide';--> statement-breakpoint
ALTER TYPE "public"."lemma_edit_change_type" ADD VALUE 'phrase_merge';--> statement-breakpoint
ALTER TABLE "translations" DROP CONSTRAINT "translations_lemma_id_lemmas_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "translations_lemma_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "translations_source_lookup_idx";--> statement-breakpoint
ALTER TABLE "lemma_edit_history" ALTER COLUMN "lemma_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lemma_edit_history" ADD COLUMN "phrase_id" uuid;--> statement-breakpoint
ALTER TABLE "phrases" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lemma_edit_history" ADD CONSTRAINT "lemma_edit_history_phrase_id_phrases_id_fk" FOREIGN KEY ("phrase_id") REFERENCES "public"."phrases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lemma_edit_history_phrase_idx" ON "lemma_edit_history" USING btree ("phrase_id","created_at");--> statement-breakpoint
-- T-14.7: enforce that exactly one of lemma_id / phrase_id is set
-- so the audit reader never has to guess which side a row
-- describes. Existing rows all have lemma_id set, so the
-- constraint is satisfied immediately for every legacy row.
ALTER TABLE "lemma_edit_history"
  ADD CONSTRAINT "lemma_edit_history_target_xor_chk"
  CHECK ((lemma_id IS NOT NULL) <> (phrase_id IS NOT NULL));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "translations_source_lookup_idx" ON "translations" USING btree ("target_type","target_id","source","source_id");--> statement-breakpoint
ALTER TABLE "translations" DROP COLUMN IF EXISTS "lemma_id";
