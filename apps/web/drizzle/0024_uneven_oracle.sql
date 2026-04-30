CREATE TABLE IF NOT EXISTS "user_audio_listening" (
	"user_id" uuid NOT NULL,
	"audio_file_id" uuid NOT NULL,
	"text_id" uuid NOT NULL,
	"listened_ms" integer DEFAULT 0 NOT NULL,
	"last_listened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_audio_listening_user_id_audio_file_id_pk" PRIMARY KEY("user_id","audio_file_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_audio_listening" ADD CONSTRAINT "user_audio_listening_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_audio_listening" ADD CONSTRAINT "user_audio_listening_audio_file_id_audio_files_id_fk" FOREIGN KEY ("audio_file_id") REFERENCES "public"."audio_files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_audio_listening" ADD CONSTRAINT "user_audio_listening_text_id_texts_id_fk" FOREIGN KEY ("text_id") REFERENCES "public"."texts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_audio_listening_user_text_idx" ON "user_audio_listening" USING btree ("user_id","text_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_audio_listening_text_idx" ON "user_audio_listening" USING btree ("text_id");