ALTER TABLE text_chapters ADD COLUMN hindi_review_revision uuid;
--> statement-breakpoint
-- The frequency queue already collects changes to the body, tokens, analyses,
-- occurrences and saved choices for each chapter in a transaction.
CREATE FUNCTION mark_hindi_review_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE text_chapters ch SET hindi_review_revision=gen_random_uuid()
    FROM texts t WHERE ch.id=NEW.chapter_id AND t.id=ch.text_id AND t.language='hi';
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER mark_hindi_review_changed AFTER INSERT ON pending_frequency_chapters
  FOR EACH ROW EXECUTE FUNCTION mark_hindi_review_changed();
