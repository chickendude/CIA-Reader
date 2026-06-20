CREATE TABLE IF NOT EXISTS "basque_reference_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"word" text NOT NULL,
	"source" text NOT NULL,
	"results" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "basque_reference_cache_word_source_uq" UNIQUE("word","source")
);
