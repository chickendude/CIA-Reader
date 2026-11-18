-- Only parsing-relevant Hindi changes invalidate saved analyses.
DROP TRIGGER hindi_lemmas_revision ON lemmas;
DROP TRIGGER hindi_forms_revision ON lemma_forms;
--> statement-breakpoint
CREATE FUNCTION bump_hindi_lexical_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'lemmas' THEN
    IF TG_OP = 'UPDATE' AND OLD.language IS NOT DISTINCT FROM NEW.language
      AND OLD.headword IS NOT DISTINCT FROM NEW.headword AND OLD.pos IS NOT DISTINCT FROM NEW.pos THEN
      RETURN NULL;
    END IF;
    IF (TG_OP <> 'INSERT' AND OLD.language = 'hi') OR (TG_OP <> 'DELETE' AND NEW.language = 'hi') THEN
      UPDATE hindi_dictionary_state SET revision = revision + 1 WHERE id = 1;
    END IF;
  ELSE
    IF TG_OP = 'UPDATE' AND OLD.surface IS NOT DISTINCT FROM NEW.surface
      AND OLD.lemma_id IS NOT DISTINCT FROM NEW.lemma_id
      AND OLD.quarantined_at IS NOT DISTINCT FROM NEW.quarantined_at THEN
      RETURN NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM hindi_entries WHERE lemma_id IN (
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.lemma_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.lemma_id END)) THEN
      UPDATE hindi_dictionary_state SET revision = revision + 1 WHERE id = 1;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER hindi_lemmas_revision AFTER INSERT OR UPDATE OR DELETE ON lemmas
FOR EACH ROW EXECUTE FUNCTION bump_hindi_lexical_revision();
--> statement-breakpoint
CREATE TRIGGER hindi_forms_revision AFTER INSERT OR UPDATE OR DELETE ON lemma_forms
FOR EACH ROW EXECUTE FUNCTION bump_hindi_lexical_revision();
