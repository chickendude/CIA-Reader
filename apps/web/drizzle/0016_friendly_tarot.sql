CREATE TYPE "public"."lemma_proposal_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lemma_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposer_id" uuid,
	"language" "language" NOT NULL,
	"headword" text NOT NULL,
	"pos" text NOT NULL,
	"gloss_default" text,
	"notes" text,
	"status" "lemma_proposal_status" DEFAULT 'pending' NOT NULL,
	"promoted_lemma_id" uuid,
	"reviewer_id" uuid,
	"reviewer_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lemma_proposals" ADD CONSTRAINT "lemma_proposals_proposer_id_users_id_fk" FOREIGN KEY ("proposer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lemma_proposals" ADD CONSTRAINT "lemma_proposals_promoted_lemma_id_lemmas_id_fk" FOREIGN KEY ("promoted_lemma_id") REFERENCES "public"."lemmas"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lemma_proposals" ADD CONSTRAINT "lemma_proposals_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lemma_proposals_lang_status_idx" ON "lemma_proposals" USING btree ("language","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lemma_proposals_headword_idx" ON "lemma_proposals" USING btree ("language","headword","pos");