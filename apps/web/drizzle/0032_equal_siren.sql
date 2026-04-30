ALTER TABLE "translations" DROP CONSTRAINT "translations_lemma_id_lemmas_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "translations_lemma_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "translations_source_lookup_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "translations_source_lookup_idx" ON "translations" USING btree ("target_type","target_id","source","source_id");--> statement-breakpoint
ALTER TABLE "translations" DROP COLUMN IF EXISTS "lemma_id";