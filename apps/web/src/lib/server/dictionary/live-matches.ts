import { sql, type SQL } from 'drizzle-orm';

// The input supplies the language and original spelling of words missed by a saved parse.
// Keep the original spelling so callers can join matches back to individual occurrences.
export function liveDictionaryMatches(words: SQL) {
  const matches = (column: SQL) => sql`lower(normalize(${column})) = lower(w.spelling)
    AND (w.language <> 'hi' OR ${column} = w.spelling)`;
  return sql`
    WITH wanted AS MATERIALIZED (
      SELECT DISTINCT language, surface, CASE WHEN language='hi'
        THEN normalize(translate(surface, U&'\\200C\\200D\\FEFF', ''))
        ELSE normalize(trim(regexp_replace(surface, '[[:space:]]+', ' ', 'g'))) END AS spelling
      FROM (${words}) input
    ), candidates AS (
      SELECT w.*, l.id FROM wanted w JOIN lemmas l ON l.language=w.language AND ${matches(sql`l.headword`)}
      UNION
      SELECT w.*, f.lemma_id FROM wanted w JOIN lemma_forms f ON ${matches(sql`f.surface`)}
      WHERE f.quarantined_at IS NULL
      UNION
      SELECT w.*, f.lemma_id FROM wanted w JOIN dictionary_pattern_forms f ON ${matches(sql`f.surface`)}
      UNION
      SELECT w.*, h.lemma_id FROM dictionary_entries h
      CROSS JOIN LATERAL jsonb_array_elements_text(h.entry->'alternative_headwords') alt(surface)
      JOIN wanted w ON ${matches(sql`alt.surface`)}
    )
    SELECT w.language,w.surface,w.id FROM candidates w JOIN dictionary_entries h ON h.lemma_id=w.id
    JOIN lemmas l ON l.id=w.id AND l.language=w.language
    WHERE NOT EXISTS (SELECT FROM jsonb_array_elements_text(h.entry->'excluded_forms') x(form)
      WHERE ${matches(sql`x.form`)})
  `;
}

// Only consult the current dictionary for tokens the reader would look up again.
export function liveTokenMatches(textIds: SQL) {
  return sql`
    WITH missing AS MATERIALIZED (
      SELECT t.id,t.surface,b.language FROM texts b JOIN text_chapters ch ON ch.text_id=b.id
      LEFT JOIN hindi_chapter_analyses a ON a.chapter_id=ch.id
      JOIN text_tokens t ON t.chapter_id=ch.id
      WHERE b.id IN (${textIds}) AND t.is_word AND t.is_oov AND t.lemma_id IS NULL
        AND (b.language<>'hi' OR a.revision IS DISTINCT FROM (SELECT revision FROM hindi_dictionary_state WHERE id=1))
    )
    SELECT t.id AS token_id,m.id AS lemma_id FROM missing t
    JOIN (${liveDictionaryMatches(sql`SELECT language,surface FROM missing`)}) m USING (language,surface)
  `;
}
