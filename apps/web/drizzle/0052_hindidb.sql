CREATE TABLE IF NOT EXISTS "hindi_chapter_analyses" (
	"chapter_id" uuid PRIMARY KEY NOT NULL,
	"revision" bigint NOT NULL,
	"parser_version" text NOT NULL,
	"source_words" integer NOT NULL,
	"unresolved_words" integer NOT NULL,
	"stats" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hindi_dictionary_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hindi_entries" (
	"lemma_id" uuid PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"entry" jsonb NOT NULL,
	CONSTRAINT "hindi_entries_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hindi_occurrences" (
	"chapter_id" uuid NOT NULL,
	"start_idx" integer NOT NULL,
	"end_idx" integer NOT NULL,
	"lemma_id" uuid NOT NULL,
	"source_start" integer NOT NULL,
	"source_end" integer NOT NULL,
	"rules" jsonb NOT NULL,
	CONSTRAINT "hindi_occurrences_chapter_id_start_idx_end_idx_lemma_id_pk" PRIMARY KEY("chapter_id","start_idx","end_idx","lemma_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hindi_chapter_analyses" ADD CONSTRAINT "hindi_chapter_analyses_chapter_id_text_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."text_chapters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hindi_entries" ADD CONSTRAINT "hindi_entries_lemma_id_lemmas_id_fk" FOREIGN KEY ("lemma_id") REFERENCES "public"."lemmas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hindi_occurrences" ADD CONSTRAINT "hindi_occurrences_chapter_id_text_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."text_chapters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hindi_occurrences" ADD CONSTRAINT "hindi_occurrences_lemma_id_lemmas_id_fk" FOREIGN KEY ("lemma_id") REFERENCES "public"."lemmas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hindi_occurrences_lemma_idx" ON "hindi_occurrences" USING btree ("lemma_id","chapter_id");--> statement-breakpoint
CREATE FUNCTION bump_hindi_dictionary_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE hindi_dictionary_state SET revision = revision + 1 WHERE id = 1;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER hindi_entries_revision AFTER INSERT OR UPDATE OR DELETE ON hindi_entries
FOR EACH STATEMENT EXECUTE FUNCTION bump_hindi_dictionary_revision();
--> statement-breakpoint
CREATE TRIGGER hindi_lemmas_revision AFTER INSERT OR UPDATE OR DELETE ON lemmas
FOR EACH STATEMENT EXECUTE FUNCTION bump_hindi_dictionary_revision();
--> statement-breakpoint
CREATE TRIGGER hindi_forms_revision AFTER INSERT OR UPDATE OR DELETE ON lemma_forms
FOR EACH STATEMENT EXECUTE FUNCTION bump_hindi_dictionary_revision();
--> statement-breakpoint
CREATE VIEW vocabulary_occurrences AS
SELECT tt.chapter_id, tt.lemma_id, tt.is_word
FROM text_tokens tt
WHERE NOT EXISTS (SELECT 1 FROM hindi_chapter_analyses a WHERE a.chapter_id = tt.chapter_id)
UNION ALL
SELECT chapter_id, lemma_id, true FROM hindi_occurrences
UNION ALL
SELECT a.chapter_id, NULL::uuid, true
FROM hindi_chapter_analyses a CROSS JOIN LATERAL generate_series(1, a.unresolved_words);
--> statement-breakpoint
CREATE FUNCTION manage_hindi_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.language = 'hi' AND EXISTS(SELECT 1 FROM hindi_dictionary_state WHERE id=1) THEN
    IF NEW.source = 'official_dictionary' THEN
      RAISE EXCEPTION 'HindiDB owns the Hindi dictionary; edit it in Parhiba instead of importing another Hindi source';
    END IF;
    INSERT INTO hindi_entries(lemma_id,external_id,entry)
      VALUES(NEW.id,'parhiba:'||NEW.id,jsonb_build_object('lemma',NEW.headword,'pos',NEW.pos,
        'paradigm','invariant','source','Parhiba curator','review_status','reviewed'))
      ON CONFLICT(lemma_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER hindi_new_entry AFTER INSERT ON lemmas FOR EACH ROW EXECUTE FUNCTION manage_hindi_entry();
--> statement-breakpoint
CREATE FUNCTION exclude_deleted_hindi_form() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE hindi_entries SET entry = jsonb_set(entry,'{excluded_forms}',
    COALESCE(entry->'excluded_forms','[]'::jsonb) || to_jsonb(OLD.surface))
  WHERE lemma_id=OLD.lemma_id AND NOT COALESCE(entry->'excluded_forms','[]'::jsonb) ? OLD.surface;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER hindi_removed_form AFTER DELETE ON lemma_forms FOR EACH ROW EXECUTE FUNCTION exclude_deleted_hindi_form();
