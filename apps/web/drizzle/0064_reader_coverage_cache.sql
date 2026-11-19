CREATE TABLE reader_vocabulary_revisions (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE official_coverage_generation (
  singleton boolean PRIMARY KEY CHECK (singleton),
  revision bigint NOT NULL
);
--> statement-breakpoint
INSERT INTO official_coverage_generation VALUES (true, 1);
--> statement-breakpoint
-- The book IDs and denominators are shared by readers of the same catalog revision.
CREATE TABLE official_coverage_layouts (
  revision bigint PRIMARY KEY,
  book_ids uuid[] NOT NULL,
  words integer[] NOT NULL,
  unique_words integer[] NOT NULL,
  unresolved integer[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE reader_coverage_cache (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  catalog_revision bigint NOT NULL REFERENCES official_coverage_layouts(revision),
  vocabulary_revision bigint NOT NULL,
  known_words integer[] NOT NULL,
  learning_words integer[] NOT NULL,
  known_entries integer[] NOT NULL
);
--> statement-breakpoint
CREATE INDEX reader_coverage_layout_idx ON reader_coverage_cache(catalog_revision);
--> statement-breakpoint
CREATE FUNCTION bump_reader_vocabulary_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO reader_vocabulary_revisions SELECT id, 1 FROM users WHERE id IN (
      SELECT coalesce(n.user_id,o.user_id)
      FROM old_words o FULL JOIN new_words n USING (user_id,lemma_id)
      WHERE n.status IS DISTINCT FROM o.status
        AND (n.status IN ('known','learning') OR o.status IN ('known','learning'))
    ) ORDER BY id ON CONFLICT (user_id) DO UPDATE SET revision=reader_vocabulary_revisions.revision+1;
  ELSE
    INSERT INTO reader_vocabulary_revisions SELECT id, 1 FROM users
    WHERE id IN (SELECT user_id FROM changed WHERE status IN ('known','learning'))
    ORDER BY id ON CONFLICT (user_id) DO UPDATE SET revision=reader_vocabulary_revisions.revision+1;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER coverage_vocab_insert AFTER INSERT ON user_known_lemmas REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION bump_reader_vocabulary_revision();
--> statement-breakpoint
CREATE TRIGGER coverage_vocab_delete AFTER DELETE ON user_known_lemmas REFERENCING OLD TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION bump_reader_vocabulary_revision();
--> statement-breakpoint
CREATE TRIGGER coverage_vocab_update AFTER UPDATE ON user_known_lemmas REFERENCING OLD TABLE AS old_words NEW TABLE AS new_words
  FOR EACH STATEMENT EXECUTE FUNCTION bump_reader_vocabulary_revision();
--> statement-breakpoint
CREATE FUNCTION bump_official_coverage_generation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE official_coverage_generation SET revision=revision+1;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER coverage_official_text_insert AFTER INSERT ON texts FOR EACH ROW
  WHEN (NEW.visibility='official') EXECUTE FUNCTION bump_official_coverage_generation();
--> statement-breakpoint
CREATE FUNCTION invalidate_deleted_coverage_text() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.visibility='official' OR EXISTS (
    SELECT FROM collection_items m JOIN collections c ON c.id=m.collection_id
    WHERE m.text_id=OLD.id AND c.kind='chapter_book' AND c.visibility='official'
  ) THEN
    UPDATE official_coverage_generation SET revision=revision+1;
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER coverage_official_text_delete BEFORE DELETE ON texts
  FOR EACH ROW EXECUTE FUNCTION invalidate_deleted_coverage_text();
--> statement-breakpoint
CREATE TRIGGER coverage_official_text_visibility AFTER UPDATE OF visibility ON texts FOR EACH ROW
  WHEN (NEW.visibility IS DISTINCT FROM OLD.visibility AND (NEW.visibility='official' OR OLD.visibility='official'))
  EXECUTE FUNCTION bump_official_coverage_generation();
--> statement-breakpoint
CREATE TRIGGER coverage_official_collection_insert AFTER INSERT ON collections FOR EACH ROW
  WHEN (NEW.kind='chapter_book' AND NEW.visibility='official') EXECUTE FUNCTION bump_official_coverage_generation();
--> statement-breakpoint
CREATE TRIGGER coverage_official_collection_delete AFTER DELETE ON collections FOR EACH ROW
  WHEN (OLD.kind='chapter_book') EXECUTE FUNCTION bump_official_coverage_generation();
--> statement-breakpoint
CREATE TRIGGER coverage_official_collection_change AFTER UPDATE OF kind,visibility ON collections FOR EACH ROW
  WHEN ((NEW.kind='chapter_book' OR OLD.kind='chapter_book') AND (NEW.kind IS DISTINCT FROM OLD.kind OR NEW.visibility IS DISTINCT FROM OLD.visibility))
  EXECUTE FUNCTION bump_official_coverage_generation();
--> statement-breakpoint
CREATE FUNCTION invalidate_member_coverage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT FROM changed m JOIN collections c ON c.id=m.collection_id JOIN texts t ON t.id=m.text_id
    WHERE c.kind='chapter_book' AND (c.visibility='official' OR t.visibility='official')
  ) THEN
    UPDATE official_coverage_generation SET revision=revision+1;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION invalidate_frequency_coverage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT FROM (SELECT DISTINCT text_id FROM changed) f JOIN texts t ON t.id=f.text_id
    WHERE t.visibility='official' OR EXISTS (
      SELECT FROM collection_items m JOIN collections c ON c.id=m.collection_id
      WHERE m.text_id=t.id AND c.visibility='official' AND c.kind='chapter_book'
    )
  ) THEN
    UPDATE official_coverage_generation SET revision=revision+1;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
DO $$
DECLARE rel text; fn text;
BEGIN
  FOR rel,fn IN VALUES ('collection_items','invalidate_member_coverage'),('book_word_frequencies','invalidate_frequency_coverage') LOOP
    EXECUTE format('CREATE TRIGGER coverage_insert AFTER INSERT ON %I REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION %I()', rel,fn);
    EXECUTE format('CREATE TRIGGER coverage_delete AFTER DELETE ON %I REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION %I()', rel,fn);
    EXECUTE format('CREATE TRIGGER coverage_update_old AFTER UPDATE ON %I REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION %I()', rel,fn);
    EXECUTE format('CREATE TRIGGER coverage_update_new AFTER UPDATE ON %I REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION %I()', rel,fn);
  END LOOP;
END $$;
