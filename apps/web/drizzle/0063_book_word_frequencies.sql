-- NULL holds the physical words with no resolved dictionary entry.
CREATE TABLE book_word_frequencies (
  text_id uuid NOT NULL REFERENCES texts(id) ON DELETE CASCADE,
  lemma_id uuid,
  occurrences integer NOT NULL CHECK (occurrences > 0),
  UNIQUE NULLS NOT DISTINCT (text_id, lemma_id)
);
--> statement-breakpoint
CREATE INDEX book_word_frequencies_lemma_idx ON book_word_frequencies (lemma_id, text_id);
--> statement-breakpoint
CREATE FUNCTION chapter_word_counts(chapter uuid)
RETURNS TABLE (lemma_id uuid, occurrences integer) LANGUAGE sql STABLE AS $$
  WITH analysis AS MATERIALIZED (
    SELECT a.source_words, md5(ch.body) AS body_hash
    FROM hindi_chapter_analyses a JOIN text_chapters ch ON ch.id=a.chapter_id
    WHERE a.chapter_id=chapter
  ), spans AS MATERIALIZED (
    SELECT o.start_idx, o.source_start, o.source_end,
           array_agg(o.lemma_id::text ORDER BY o.lemma_id) AS candidates
    FROM hindi_occurrences o WHERE o.chapter_id=chapter
    GROUP BY o.start_idx, o.source_start, o.source_end
  ), selected AS (
    -- As in the reader, prefer the first selected entry from the shortest valid span.
    SELECT DISTINCT ON (s.start_idx) s.start_idx, choice.id::uuid AS lemma
    FROM spans s JOIN hindi_context_choices c ON c.chapter_id=chapter
      AND c.source_start=s.source_start AND c.source_end=s.source_end
    CROSS JOIN LATERAL jsonb_array_elements_text(c.selected_lemma_ids) WITH ORDINALITY choice(id, ord)
    WHERE c.status IN ('confirmed','ai_suggested')
      AND c.metadata->>'chapter_hash'=(SELECT body_hash FROM analysis)
      AND c.candidate_lemma_ids @> to_jsonb(s.candidates)
      AND c.candidate_lemma_ids <@ to_jsonb(s.candidates)
      AND choice.id=ANY(s.candidates)
    ORDER BY s.start_idx, s.source_end, c.source_occurrence_id, choice.ord
  ), unambiguous AS (
    SELECT s.start_idx, min(candidate.id)::uuid AS lemma
    FROM spans s CROSS JOIN LATERAL unnest(s.candidates) candidate(id)
    GROUP BY s.start_idx HAVING count(DISTINCT candidate.id)=1
  ), resolved AS MATERIALIZED (
    SELECT coalesce(s.lemma, u.lemma) AS lemma, count(*)::int AS n
    FROM selected s FULL JOIN unambiguous u USING (start_idx)
    GROUP BY 1
  )
  SELECT t.lemma_id, count(*)::int FROM text_tokens t
  WHERE t.chapter_id=chapter AND t.is_word AND NOT EXISTS (SELECT FROM analysis)
  GROUP BY t.lemma_id
  UNION ALL
  SELECT r.lemma, r.n FROM resolved r WHERE EXISTS (SELECT FROM analysis)
  UNION ALL
  SELECT NULL::uuid, gaps.n FROM (
    SELECT source_words - coalesce((SELECT sum(n) FROM resolved), 0)::int AS n FROM analysis
  ) gaps WHERE gaps.n > 0
$$;
--> statement-breakpoint
-- Store chapter subtotals so a context edit only reanalyzes the affected chapter.
CREATE TABLE chapter_word_frequencies (
  chapter_id uuid NOT NULL REFERENCES text_chapters(id) ON DELETE CASCADE,
  lemma_id uuid,
  occurrences integer NOT NULL CHECK (occurrences > 0),
  UNIQUE NULLS NOT DISTINCT (chapter_id, lemma_id)
);
--> statement-breakpoint
CREATE TABLE pending_frequency_chapters (chapter_id uuid PRIMARY KEY);
--> statement-breakpoint
CREATE TABLE pending_frequency_books (text_id uuid PRIMARY KEY);
--> statement-breakpoint
CREATE FUNCTION queue_frequency_chapters() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO pending_frequency_chapters SELECT DISTINCT chapter_id FROM changed ORDER BY chapter_id
    ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;
--> statement-breakpoint
-- A parser/import may write thousands of tokens and choices in several statements.
-- Transition tables enqueue each chapter just once per transaction.
DO $$
DECLARE rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY['text_tokens','hindi_occurrences','hindi_context_choices','hindi_chapter_analyses'] LOOP
    EXECUTE format('CREATE TRIGGER frequency_insert AFTER INSERT ON %I REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION queue_frequency_chapters()', rel);
    EXECUTE format('CREATE TRIGGER frequency_delete AFTER DELETE ON %I REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION queue_frequency_chapters()', rel);
    EXECUTE format('CREATE TRIGGER frequency_update AFTER UPDATE ON %I REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION queue_frequency_chapters()', rel);
    EXECUTE format('CREATE TRIGGER frequency_update_old AFTER UPDATE ON %I REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION queue_frequency_chapters()', rel);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION queue_chapter_frequency_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.text_id IS DISTINCT FROM OLD.text_id THEN
    INSERT INTO pending_frequency_books VALUES (OLD.text_id) ON CONFLICT DO NOTHING;
  END IF;
  IF TG_OP='UPDATE' THEN
    INSERT INTO pending_frequency_chapters VALUES (NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER frequency_chapter_change AFTER UPDATE OF body,text_id OR DELETE ON text_chapters
FOR EACH ROW EXECUTE FUNCTION queue_chapter_frequency_change();
--> statement-breakpoint
CREATE FUNCTION refresh_chapter_frequencies() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE book uuid;
BEGIN
  DELETE FROM pending_frequency_chapters WHERE chapter_id=NEW.chapter_id;
  SELECT text_id INTO book FROM text_chapters WHERE id=NEW.chapter_id;
  IF book IS NOT NULL THEN
    DELETE FROM chapter_word_frequencies WHERE chapter_id=NEW.chapter_id;
    INSERT INTO chapter_word_frequencies SELECT NEW.chapter_id, f.* FROM chapter_word_counts(NEW.chapter_id) f;
    INSERT INTO pending_frequency_books VALUES (book) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER refresh_chapter_word_counts AFTER INSERT ON pending_frequency_chapters
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION refresh_chapter_frequencies();
--> statement-breakpoint
CREATE FUNCTION refresh_book_frequencies() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM pending_frequency_books WHERE text_id=NEW.text_id;
  DELETE FROM book_word_frequencies WHERE text_id=NEW.text_id;
  INSERT INTO book_word_frequencies
    SELECT ch.text_id, f.lemma_id, sum(f.occurrences)::int
    FROM text_chapters ch JOIN chapter_word_frequencies f ON f.chapter_id=ch.id
    WHERE ch.text_id=NEW.text_id GROUP BY ch.text_id, f.lemma_id;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER refresh_book_word_counts AFTER INSERT ON pending_frequency_books
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION refresh_book_frequencies();
--> statement-breakpoint
INSERT INTO chapter_word_frequencies
  SELECT ch.id, f.* FROM text_chapters ch CROSS JOIN LATERAL chapter_word_counts(ch.id) f;
--> statement-breakpoint
INSERT INTO book_word_frequencies
  SELECT ch.text_id, f.lemma_id, sum(f.occurrences)::int
  FROM text_chapters ch JOIN chapter_word_frequencies f ON f.chapter_id=ch.id
  GROUP BY ch.text_id, f.lemma_id;
