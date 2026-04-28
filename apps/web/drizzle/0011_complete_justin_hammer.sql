ALTER TYPE "public"."lemma_edit_change_type" ADD VALUE 'translation_reorder';--> statement-breakpoint
ALTER TABLE "translations" ADD COLUMN "display_rank" integer;