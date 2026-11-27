import { sql } from 'drizzle-orm';

// Use the same Hindi reading as chapter_word_counts to subtract from the correct frequency.
function ignoredWords(userId: string) {
  return sql`
    SELECT t.chapter_id, ch.text_id,
      CASE WHEN a.chapter_id IS NULL THEN t.lemma_id ELSE reading.lemma_id END AS lemma_id
    FROM reader_ignored_tokens i JOIN text_tokens t ON t.id=i.token_id
    JOIN text_chapters ch ON ch.id=t.chapter_id
    LEFT JOIN hindi_chapter_analyses a ON a.chapter_id=t.chapter_id
    LEFT JOIN LATERAL (
      WITH spans AS (
        SELECT source_start,source_end,array_agg(lemma_id::text ORDER BY lemma_id) AS candidates
        FROM hindi_occurrences WHERE chapter_id=t.chapter_id AND start_idx=t.idx
        GROUP BY source_start,source_end
      )
      SELECT coalesce((
        SELECT pick.id FROM spans s JOIN hindi_context_choices c ON c.chapter_id=t.chapter_id
          AND c.source_start=s.source_start AND c.source_end=s.source_end
        CROSS JOIN LATERAL jsonb_array_elements_text(c.selected_lemma_ids) WITH ORDINALITY pick(id,ord)
        WHERE c.status IN ('confirmed','ai_suggested') AND c.metadata->>'chapter_hash'=md5(ch.body)
          AND c.candidate_lemma_ids @> to_jsonb(s.candidates) AND c.candidate_lemma_ids <@ to_jsonb(s.candidates)
          AND pick.id=ANY(s.candidates)
        ORDER BY s.source_end,c.source_occurrence_id,pick.ord LIMIT 1
      ), (
        SELECT min(id) FROM spans CROSS JOIN LATERAL unnest(candidates) word(id)
        HAVING count(DISTINCT id)=1
      ))::uuid AS lemma_id
    ) reading ON a.chapter_id IS NOT NULL
    WHERE i.user_id=${userId} AND t.is_word
  `;
}

export function readerFrequencies(scope: 'book' | 'chapter', userId?: string | null) {
  const table = sql.identifier(scope + '_word_frequencies');
  if (!userId) return sql`${table}`;
  const key = sql.identifier(scope === 'book' ? 'text_id' : 'chapter_id');
  return sql`(
    SELECT f.${key}, f.lemma_id, (f.occurrences-coalesce(d.n,0))::int AS occurrences
    FROM ${table} f LEFT JOIN (
      SELECT ${key}, lemma_id, count(*) AS n FROM (${ignoredWords(userId)}) ignored GROUP BY ${key},lemma_id
    ) d ON f.${key}=d.${key} AND f.lemma_id IS NOT DISTINCT FROM d.lemma_id
    WHERE f.occurrences>coalesce(d.n,0)
  )`;
}
