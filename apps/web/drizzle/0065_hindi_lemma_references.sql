-- Only flags attached to a live entry have a destination UUID.
WITH moved AS (
  DELETE FROM hindi_reference_cache c USING hindi_entries h
  WHERE c.key = 'loan:' || h.external_id AND h.external_id <> h.lemma_id::text
  RETURNING h.lemma_id, c.result, c.retrieved_at
)
INSERT INTO hindi_reference_cache (key, result, retrieved_at)
SELECT 'loan:' || lemma_id, result, retrieved_at FROM moved
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
-- Rebuild each live group from its member rows. The old parser used the
-- first row in external ID order as its source of ordering and primary.
-- Only the representation changes. Keep existing chapter analyses current.
ALTER TABLE hindi_entries DISABLE TRIGGER hindi_entries_revision;
--> statement-breakpoint
WITH members AS (
  SELECT h.lemma_id, h.external_id, h.entry, l.pos, h.entry->>'group_id' AS old_group
  FROM hindi_entries h JOIN lemmas l ON l.id = h.lemma_id
  WHERE h.entry->>'group_id' IS NOT NULL
), representatives AS (
  SELECT DISTINCT ON (old_group) old_group, entry FROM members
  ORDER BY old_group, external_id
), groups AS MATERIALIZED (
  SELECT r.*, CASE WHEN old_group ~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
    THEN old_group ELSE gen_random_uuid()::text END AS group_id
  FROM representatives r
), ordered AS (
  SELECT m.*, g.group_id, saved.ordinal,
    saved.member_id = g.entry->>'group_primary' AS is_primary
  FROM members m JOIN groups g USING (old_group)
  LEFT JOIN LATERAL (
    SELECT u.member->>'id' AS member_id, u.ordinal FROM
      jsonb_array_elements(g.entry->'group_uses') WITH ORDINALITY AS u(member, ordinal)
    WHERE u.member->>'pos' = m.pos ORDER BY u.ordinal LIMIT 1
  ) saved ON true
), metadata AS (
  SELECT old_group, group_id,
    (array_agg(lemma_id ORDER BY is_primary DESC NULLS LAST, ordinal, external_id))[1] AS primary_id,
    jsonb_agg(jsonb_build_object('id', lemma_id, 'pos', pos) ORDER BY ordinal, external_id) AS uses
  FROM ordered GROUP BY old_group, group_id
), updated AS (
  SELECT m.lemma_id, m.entry || jsonb_build_object(
    'group_id', g.group_id, 'group_primary', g.primary_id, 'group_uses', g.uses) AS entry
  FROM members m JOIN metadata g USING (old_group)
)
UPDATE hindi_entries h SET entry = u.entry FROM updated u
WHERE h.lemma_id = u.lemma_id AND h.entry IS DISTINCT FROM u.entry;
--> statement-breakpoint
ALTER TABLE hindi_entries ENABLE TRIGGER hindi_entries_revision;
