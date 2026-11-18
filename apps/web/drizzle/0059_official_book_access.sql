CREATE TABLE IF NOT EXISTS "official_text_copies" (
	"source_text_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"text_id" uuid NOT NULL,
	CONSTRAINT "official_text_copies_source_text_id_user_id_pk" PRIMARY KEY("source_text_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "texts" ADD COLUMN "staff_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "official_text_copies" ADD CONSTRAINT "official_text_copies_source_text_id_texts_id_fk" FOREIGN KEY ("source_text_id") REFERENCES "public"."texts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "official_text_copies" ADD CONSTRAINT "official_text_copies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "official_text_copies" ADD CONSTRAINT "official_text_copies_text_id_texts_id_fk" FOREIGN KEY ("text_id") REFERENCES "public"."texts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
