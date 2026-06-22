ALTER TYPE "public"."text_source_type" ADD VALUE 'pdf';--> statement-breakpoint
ALTER TABLE "text_chapters" ADD COLUMN "page_image_key" text;--> statement-breakpoint
ALTER TABLE "text_chapters" ADD COLUMN "page_image_mime" text;--> statement-breakpoint
ALTER TABLE "text_chapters" ADD COLUMN "page_width" integer;--> statement-breakpoint
ALTER TABLE "text_chapters" ADD COLUMN "page_height" integer;--> statement-breakpoint
ALTER TABLE "text_tokens" ADD COLUMN "bbox" jsonb;