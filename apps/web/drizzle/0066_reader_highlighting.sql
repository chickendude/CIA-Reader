ALTER TYPE "highlight_style" ADD VALUE 'none';
--> statement-breakpoint
ALTER TABLE "user_languages" ADD COLUMN "highlight_learning" boolean DEFAULT true NOT NULL;
