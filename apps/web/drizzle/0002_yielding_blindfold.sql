CREATE TYPE "public"."language_baseline" AS ENUM('none', 'beginner', 'intermediate');--> statement-breakpoint
ALTER TABLE "user_languages" ADD COLUMN "baseline" "language_baseline" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarded_at" timestamp with time zone;