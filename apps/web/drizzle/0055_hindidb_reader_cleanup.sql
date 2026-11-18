-- Prefer HindiDB's reviewed wording, retaining source originals as metadata.
UPDATE translations original SET hidden=true
FROM hindi_entries h, LATERAL jsonb_array_elements(h.entry->'definitions') WITH ORDINALITY d(definition,idx)
WHERE original.target_type='lemma' AND original.target_id=h.lemma_id
  AND original.source_id='hindidb:'||h.external_id||':'||(d.idx-1)||':original'
  AND original.body=d.definition->>'original'
  AND COALESCE(d.definition->>'translation','')<>'';
--> statement-breakpoint
UPDATE lemmas l SET gloss_default=(SELECT body FROM translations t WHERE t.target_type='lemma'
  AND t.target_id=l.id AND t.target_language='en' AND NOT t.hidden ORDER BY t.source_id LIMIT 1)
WHERE l.id IN (SELECT lemma_id FROM hindi_entries);
--> statement-breakpoint
-- Parser derivations are available in hindi_occurrences.rules, not form chips.
UPDATE text_tokens t SET features=t.features-'HindiDBRules',
  lemma_candidates=COALESCE((SELECT jsonb_agg(
    jsonb_set(c,'{features}',COALESCE(c->'features','{}'::jsonb)-'HindiDBRules'))
    FROM jsonb_array_elements(t.lemma_candidates) c),'[]'::jsonb)
FROM hindi_chapter_analyses a WHERE a.chapter_id=t.chapter_id;
