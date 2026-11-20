ALTER TABLE hindi_entries RENAME TO dictionary_entries;
--> statement-breakpoint
-- Older book importers and Hindi review queries address entries through this view.
CREATE VIEW hindi_entries AS SELECT e.* FROM dictionary_entries e
WHERE EXISTS (SELECT 1 FROM lemmas l WHERE l.id=e.lemma_id AND l.language='hi');
--> statement-breakpoint
DROP TRIGGER hindi_entries_revision ON dictionary_entries;
--> statement-breakpoint
CREATE FUNCTION revise_hindi_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM lemmas WHERE id=COALESCE(NEW.lemma_id, OLD.lemma_id) AND language='hi') THEN
    UPDATE hindi_dictionary_state SET revision=revision+1 WHERE id=1;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER hindi_entries_revision AFTER INSERT OR UPDATE OR DELETE ON dictionary_entries
FOR EACH ROW EXECUTE FUNCTION revise_hindi_entry();
--> statement-breakpoint
-- The reader looks up aliases and generated spellings alongside the ordinary form editor's rows.
CREATE TABLE dictionary_pattern_forms (
  lemma_id uuid NOT NULL REFERENCES lemmas(id) ON DELETE CASCADE,
  surface text NOT NULL,
  PRIMARY KEY (lemma_id, surface)
);
--> statement-breakpoint
CREATE INDEX dictionary_pattern_forms_lookup ON dictionary_pattern_forms (split_part(lower(normalize(surface)), ' ', 1));
--> statement-breakpoint
CREATE INDEX dictionary_compound_lemmas ON lemmas (language, split_part(lower(normalize(headword)), ' ', 1)) WHERE strpos(headword,' ')>0;
--> statement-breakpoint
CREATE INDEX dictionary_compound_forms ON lemma_forms (split_part(lower(normalize(surface)), ' ', 1)) WHERE quarantined_at IS NULL AND strpos(surface,' ')>0;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_hindi_gloss() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
  FOR target IN SELECT DISTINCT id FROM (VALUES
    (CASE WHEN TG_OP<>'INSERT' AND OLD.target_type='lemma' THEN OLD.target_id END),
    (CASE WHEN TG_OP<>'DELETE' AND NEW.target_type='lemma' THEN NEW.target_id END)
  ) AS affected(id) WHERE id IS NOT NULL LOOP
    IF EXISTS(SELECT 1 FROM dictionary_entries WHERE lemma_id=target) THEN
      UPDATE lemmas SET gloss_default=(
        SELECT string_agg(body, '; ' ORDER BY display_rank NULLS LAST, created_at, id)
        FROM translations WHERE target_type='lemma' AND target_id=target
          AND target_language='en' AND source IN ('curator','official_dictionary') AND NOT hidden AND NOT is_private
      ) WHERE id=target;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
