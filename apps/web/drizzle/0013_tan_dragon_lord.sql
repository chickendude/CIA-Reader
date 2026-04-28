CREATE TYPE "public"."reading_width" AS ENUM('narrow', 'medium', 'wide');--> statement-breakpoint
ALTER TABLE "user_languages" ADD COLUMN "reading_width" "reading_width" DEFAULT 'medium' NOT NULL;