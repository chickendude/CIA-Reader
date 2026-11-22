-- Study coverage splits an ambiguous word among its possible readings. Reader
-- coverage has a separate count because it requires a resolved dictionary entry.
CREATE TABLE hindi_chapter_study_frequencies (
  chapter_id uuid NOT NULL REFERENCES text_chapters(id) ON DELETE CASCADE,
  lemma_id uuid,
  occurrences numeric NOT NULL,
  matches integer NOT NULL,
  UNIQUE NULLS NOT DISTINCT (chapter_id, lemma_id)
);
--> statement-breakpoint
CREATE TABLE hindi_book_study_frequencies (
  text_id uuid NOT NULL REFERENCES texts(id) ON DELETE CASCADE,
  lemma_id uuid,
  occurrences numeric NOT NULL,
  matches integer NOT NULL,
  UNIQUE NULLS NOT DISTINCT (text_id, lemma_id)
);
--> statement-breakpoint
-- A single index is requested when subtracting a reader's ignored occurrence.
CREATE FUNCTION hindi_study_readings(chapter uuid, token_idx integer DEFAULT NULL)
RETURNS TABLE (idx integer, entries jsonb) LANGUAGE sql STABLE AS $$
  WITH spans AS (
    SELECT o.start_idx, o.end_idx, o.source_start, o.source_end,
      to_jsonb(array_agg(o.lemma_id ORDER BY o.lemma_id)) AS candidates
    FROM hindi_occurrences o WHERE o.chapter_id=chapter
      AND (token_idx IS NULL OR token_idx BETWEEN o.start_idx AND o.end_idx-1)
    GROUP BY o.start_idx, o.end_idx, o.source_start, o.source_end
  ), choices AS MATERIALIZED (
    SELECT c.* FROM hindi_context_choices c
    WHERE c.chapter_id=chapter AND c.status IN ('confirmed','ai_suggested')
      AND c.selected_lemma_ids <> '[]'
      AND c.metadata->>'chapter_hash'=(SELECT md5(body) FROM text_chapters WHERE id=chapter)
  )
  SELECT DISTINCT ON (t.idx) t.idx, coalesce(c.selected_lemma_ids,s.candidates)
  FROM spans s CROSS JOIN LATERAL generate_series(s.start_idx,s.end_idx-1) word(idx)
  JOIN text_tokens t ON t.chapter_id=chapter AND t.idx=word.idx AND t.is_word
  LEFT JOIN choices c ON c.source_start=s.source_start AND c.source_end=s.source_end
    AND c.candidate_lemma_ids @> s.candidates AND s.candidates @> c.candidate_lemma_ids
    AND s.candidates @> c.selected_lemma_ids
  WHERE token_idx IS NULL OR t.idx=token_idx
  ORDER BY t.idx, (c.status IS NULL), s.end_idx-s.start_idx, s.start_idx, s.source_end,
    (c.status='confirmed') DESC, c.source_occurrence_id
$$;
--> statement-breakpoint
CREATE FUNCTION hindi_chapter_study_counts(chapter uuid)
RETURNS TABLE (lemma_id uuid, occurrences numeric, matches integer) LANGUAGE sql STABLE AS $$
  WITH grouped AS (
    SELECT entries, count(*) AS words FROM hindi_study_readings(chapter) GROUP BY entries
  )
  SELECT entry.id::uuid, sum(g.words::numeric / jsonb_array_length(g.entries)), sum(g.words)::integer
  FROM grouped g CROSS JOIN LATERAL jsonb_array_elements_text(g.entries) entry(id)
  GROUP BY entry.id
  UNION ALL
  SELECT NULL::uuid, unresolved_words::numeric, unresolved_words FROM hindi_chapter_analyses
  WHERE chapter_id=chapter AND unresolved_words>0
$$;
--> statement-breakpoint
CREATE FUNCTION hindi_book_study_counts(book uuid)
RETURNS TABLE (lemma_id uuid, occurrences numeric, matches integer) LANGUAGE sql STABLE AS $$
  WITH chapters AS (SELECT id FROM text_chapters WHERE text_id=book), parts AS (
    SELECT f.lemma_id,f.occurrences,f.matches FROM chapters c
    JOIN hindi_chapter_study_frequencies f ON f.chapter_id=c.id
    UNION ALL
    SELECT f.lemma_id,f.occurrences,f.occurrences FROM chapters c
    JOIN chapter_word_frequencies f ON f.chapter_id=c.id
    WHERE NOT EXISTS (SELECT FROM hindi_chapter_analyses a WHERE a.chapter_id=c.id)
  )
  SELECT p.lemma_id,sum(p.occurrences),sum(p.matches)::int FROM parts p GROUP BY p.lemma_id
$$;
--> statement-breakpoint
CREATE FUNCTION cache_hindi_chapter_study_counts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM hindi_chapter_study_frequencies WHERE chapter_id=NEW.chapter_id;
  IF EXISTS (SELECT FROM hindi_chapter_analyses WHERE chapter_id=NEW.chapter_id) THEN
    INSERT INTO hindi_chapter_study_frequencies
      SELECT NEW.chapter_id,f.* FROM hindi_chapter_study_counts(NEW.chapter_id) f;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
-- Triggers on the same event run alphabetically. Cache the chapter before
-- refresh_chapter_word_counts queues its book, including in immediate mode.
CREATE CONSTRAINT TRIGGER cache_hindi_chapter_counts AFTER INSERT ON pending_frequency_chapters
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cache_hindi_chapter_study_counts();
--> statement-breakpoint
CREATE FUNCTION cache_hindi_book_study_counts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM hindi_book_study_frequencies WHERE text_id=NEW.text_id;
  IF EXISTS (SELECT FROM texts WHERE id=NEW.text_id AND language='hi') THEN
    INSERT INTO hindi_book_study_frequencies
      SELECT NEW.text_id,f.* FROM hindi_book_study_counts(NEW.text_id) f;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER cache_hindi_book_counts AFTER INSERT ON pending_frequency_books
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cache_hindi_book_study_counts();
--> statement-breakpoint
INSERT INTO hindi_chapter_study_frequencies
  SELECT a.chapter_id,f.* FROM hindi_chapter_analyses a
  CROSS JOIN LATERAL hindi_chapter_study_counts(a.chapter_id) f;
--> statement-breakpoint
INSERT INTO hindi_book_study_frequencies
  SELECT t.id,f.* FROM texts t CROSS JOIN LATERAL hindi_book_study_counts(t.id) f WHERE t.language='hi';
