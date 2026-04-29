CREATE TYPE "public"."token_correction_type" AS ENUM('pick_candidate', 'manual_lemma', 'new_lemma', 'mark_proper_noun', 'mark_foreign', 'mark_not_a_word');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "token_corrections" (
	"user_id" uuid NOT NULL,
	"token_id" uuid NOT NULL,
	"type" "token_correction_type" NOT NULL,
	"chosen_lemma_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "token_corrections_user_id_token_id_pk" PRIMARY KEY("user_id","token_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "token_corrections" ADD CONSTRAINT "token_corrections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "token_corrections" ADD CONSTRAINT "token_corrections_token_id_text_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."text_tokens"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "token_corrections" ADD CONSTRAINT "token_corrections_chosen_lemma_id_lemmas_id_fk" FOREIGN KEY ("chosen_lemma_id") REFERENCES "public"."lemmas"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "token_corrections_token_idx" ON "token_corrections" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "token_corrections_chosen_lemma_idx" ON "token_corrections" USING btree ("chosen_lemma_id","type");