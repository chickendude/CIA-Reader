CREATE TYPE "public"."highlight_style" AS ENUM('underline', 'background', 'colored_text');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('hi', 'mr', 'or');--> statement-breakpoint
CREATE TYPE "public"."reader_layout_mode" AS ENUM('page', 'paged_scroll', 'continuous');--> statement-breakpoint
CREATE TYPE "public"."romanization_scheme" AS ENUM('iso15919', 'iast', 'hunterian', 'itrans');--> statement-breakpoint
CREATE TYPE "public"."script_preference" AS ENUM('native', 'native_with_romanization', 'romanization_only');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_languages" (
	"user_id" uuid NOT NULL,
	"language" "language" NOT NULL,
	"script_preference" "script_preference" DEFAULT 'native' NOT NULL,
	"romanization_scheme" "romanization_scheme" DEFAULT 'iso15919' NOT NULL,
	"known_words_count_cache" integer DEFAULT 0 NOT NULL,
	"reader_layout_mode" "reader_layout_mode" DEFAULT 'page' NOT NULL,
	"words_per_page" integer DEFAULT 250 NOT NULL,
	"font_family" text,
	"font_size" real DEFAULT 18 NOT NULL,
	"line_spacing" real DEFAULT 1.6 NOT NULL,
	"highlight_style" "highlight_style" DEFAULT 'background' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_languages_user_id_language_pk" PRIMARY KEY("user_id","language")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_languages" ADD CONSTRAINT "user_languages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
