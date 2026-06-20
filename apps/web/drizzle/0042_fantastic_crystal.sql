-- Add Yiddish ('yi') to the language enum and YIVO to romanization_scheme.
--
-- NOT done with `ALTER TYPE ... ADD VALUE`: drizzle's migrator applies
-- every pending migration inside one transaction, and Postgres forbids
-- *using* an enum value that was added to a pre-existing enum earlier in
-- the same transaction (error 55P04). The very next migration seeds a
-- Yiddish paradigm row, so on an existing database the deploy would
-- fail. Recreating the type instead is transaction-safe — values of a
-- type created in the current transaction are immediately usable.
ALTER TYPE "public"."language" RENAME TO "language_old";--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM ('hi', 'mr', 'or', 'yi');--> statement-breakpoint
ALTER TABLE "collections" ALTER COLUMN "language" TYPE "public"."language" USING "language"::text::"public"."language";--> statement-breakpoint
ALTER TABLE "curator_languages" ALTER COLUMN "language" TYPE "public"."language" USING "language"::text::"public"."language";--> statement-breakpoint
ALTER TABLE "dictionary_imports" ALTER COLUMN "language" TYPE "public"."language" USING "language"::text::"public"."language";--> statement-breakpoint
ALTER TABLE "form_lemma_overrides" ALTER COLUMN "language" TYPE "public"."language" USING "language"::text::"public"."language";--> statement-breakpoint
ALTER TABLE "lemma_proposals" ALTER COLUMN "language" TYPE "public"."language" USING "language"::text::"public"."language";--> statement-breakpoint
ALTER TABLE "lemmas" ALTER COLUMN "language" TYPE "public"."language" USING "language"::text::"public"."language";--> statement-breakpoint
ALTER TABLE "paradigms" ALTER COLUMN "language" TYPE "public"."language" USING "language"::text::"public"."language";--> statement-breakpoint
ALTER TABLE "parse_reports" ALTER COLUMN "language" TYPE "public"."language" USING "language"::text::"public"."language";--> statement-breakpoint
ALTER TABLE "phrase_proposals" ALTER COLUMN "language" TYPE "public"."language" USING "language"::text::"public"."language";--> statement-breakpoint
ALTER TABLE "phrases" ALTER COLUMN "language" TYPE "public"."language" USING "language"::text::"public"."language";--> statement-breakpoint
ALTER TABLE "texts" ALTER COLUMN "language" TYPE "public"."language" USING "language"::text::"public"."language";--> statement-breakpoint
ALTER TABLE "user_languages" ALTER COLUMN "language" TYPE "public"."language" USING "language"::text::"public"."language";--> statement-breakpoint
DROP TYPE "public"."language_old";--> statement-breakpoint
ALTER TYPE "public"."romanization_scheme" RENAME TO "romanization_scheme_old";--> statement-breakpoint
CREATE TYPE "public"."romanization_scheme" AS ENUM ('iso15919', 'iast', 'hunterian', 'itrans', 'yivo');--> statement-breakpoint
ALTER TABLE "user_languages" ALTER COLUMN "romanization_scheme" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user_languages" ALTER COLUMN "romanization_scheme" TYPE "public"."romanization_scheme" USING "romanization_scheme"::text::"public"."romanization_scheme";--> statement-breakpoint
ALTER TABLE "user_languages" ALTER COLUMN "romanization_scheme" SET DEFAULT 'iso15919';--> statement-breakpoint
DROP TYPE "public"."romanization_scheme_old";
