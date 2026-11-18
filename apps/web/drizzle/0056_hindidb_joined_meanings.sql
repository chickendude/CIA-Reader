-- Join the effective imported meanings once, preserving any edited wording.
CREATE TEMP TABLE hindi_meaning_merge ON COMMIT DROP AS
SELECT h.lemma_id, h.external_id, t.target_language,
  (array_agg(t.id ORDER BY t.hidden, t.source_id))[1] AS keep_id,
  string_agg(t.body, '; ' ORDER BY
    (regexp_match(t.source_id, ':(\d+):(original|translation)$'))[1]::int)
    FILTER (WHERE NOT t.hidden) AS body
FROM hindi_entries h JOIN translations t ON t.target_type='lemma' AND t.target_id=h.lemma_id
WHERE t.source_id LIKE 'hindidb:%' GROUP BY h.lemma_id,h.external_id,t.target_language;
--> statement-breakpoint
UPDATE translations child SET parent_translation_id=m.keep_id
FROM translations old, hindi_meaning_merge m
WHERE child.parent_translation_id=old.id AND old.target_id=m.lemma_id
  AND old.target_language=m.target_language AND old.source_id LIKE 'hindidb:%'
  AND old.id<>m.keep_id AND child.id<>m.keep_id AND m.body IS NOT NULL;
--> statement-breakpoint
DELETE FROM translations t USING hindi_meaning_merge m
WHERE t.target_type='lemma' AND t.target_id=m.lemma_id AND t.target_language=m.target_language
  AND t.source_id LIKE 'hindidb:%' AND (t.id<>m.keep_id OR m.body IS NULL);
--> statement-breakpoint
UPDATE translations t SET body=m.body,hidden=false,source_id='hindidb:'||m.external_id||':meaning:'||m.target_language
FROM hindi_meaning_merge m WHERE t.id=m.keep_id AND m.body IS NOT NULL;
--> statement-breakpoint
UPDATE lemmas l SET gloss_default=m.body FROM hindi_meaning_merge m
WHERE l.id=m.lemma_id AND m.target_language='en';
