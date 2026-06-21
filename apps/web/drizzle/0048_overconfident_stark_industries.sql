CREATE TABLE IF NOT EXISTS "sentence_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"language" text NOT NULL,
	"target_language" text NOT NULL,
	"model" text NOT NULL,
	"text_hash" text NOT NULL,
	"text" text NOT NULL,
	"translation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sentence_translations_key_uq" UNIQUE("language","target_language","model","text_hash")
);
