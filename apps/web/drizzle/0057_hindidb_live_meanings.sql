-- Hover cards must follow subsequent edits to the canonical Hindi meanings.
CREATE FUNCTION sync_hindi_gloss() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
  FOR target IN SELECT DISTINCT id FROM (VALUES
    (CASE WHEN TG_OP<>'INSERT' AND OLD.target_type='lemma' THEN OLD.target_id END),
    (CASE WHEN TG_OP<>'DELETE' AND NEW.target_type='lemma' THEN NEW.target_id END)
  ) AS affected(id) WHERE id IS NOT NULL LOOP
    IF EXISTS(SELECT 1 FROM hindi_entries WHERE lemma_id=target) THEN
      UPDATE lemmas SET gloss_default=(
        SELECT string_agg(body, '; ' ORDER BY display_rank NULLS LAST, created_at, id)
        FROM translations WHERE target_type='lemma' AND target_id=target
          AND target_language='en' AND source IN ('curator','official_dictionary') AND NOT hidden
      ) WHERE id=target;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER hindi_translation_gloss AFTER INSERT OR UPDATE OR DELETE ON translations
FOR EACH ROW EXECUTE FUNCTION sync_hindi_gloss();
