-- An older import copied the entry URL into the label beside each definition.
-- Keep any translator credit after the URL and only remove links recorded in the entry.
WITH imported AS (
  SELECT t.id, e.entry,
    substr(t.source_attribution, length('HindiDB ' || chr(183) || ' ') + 1) AS credit
  FROM translations t
  JOIN lemmas l ON l.id=t.target_id AND l.language='hi'
  JOIN dictionary_entries e ON e.lemma_id=l.id
  WHERE t.target_type='lemma' AND t.source_id LIKE 'hindidb:%'
    AND t.source_attribution LIKE 'HindiDB ' || chr(183) || ' https://en.wiktionary.org/wiki/%'
), urls AS (
  SELECT id, entry, credit, split_part(credit, '; ', 1) AS url FROM imported
)
UPDATE translations t SET source_attribution=nullif(substr(u.credit, length(u.url) + 3), '')
FROM urls u WHERE t.id=u.id AND (
  u.entry->>'source'=u.url OR EXISTS (
    SELECT FROM jsonb_array_elements(u.entry->'definitions') d WHERE d->>'source_url'=u.url
  )
);
