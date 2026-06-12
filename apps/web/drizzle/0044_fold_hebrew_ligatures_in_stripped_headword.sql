ALTER TABLE "lemmas" drop column "headword_nukta_stripped";--> statement-breakpoint
ALTER TABLE "lemmas" ADD COLUMN "headword_nukta_stripped" text GENERATED ALWAYS AS (replace(replace(replace(replace(translate(normalize("headword", NFD), '़', ''), 'װ', 'וו'), 'ױ', 'וי'), 'ײ', 'יי'), 'יַי', 'ייַ')) STORED NOT NULL;--> statement-breakpoint
-- Dropping the generated column above also dropped its index — recreate
-- it (same definition as 0025). Existing rows recompute automatically.
CREATE INDEX IF NOT EXISTS "lemmas_language_headword_stripped_idx" ON "lemmas" USING btree ("language","headword_nukta_stripped");
