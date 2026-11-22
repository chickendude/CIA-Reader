import type { LanguageCode } from '@ciareader/shared-types';
import { sql, type SQL } from 'drizzle-orm';
import { readerFrequencies } from './reader-frequencies.js';

export function studyFrequencies(books: SQL, language: LanguageCode, userId?: string) {
  if (language !== 'hi') return sql`
    SELECT f.text_id, f.lemma_id, f.occurrences, f.occurrences AS matches
    FROM (${books}) b JOIN ${readerFrequencies('book', userId)} f ON f.text_id = b.id
  `;
  const counts = sql`SELECT f.* FROM (${books}) b JOIN hindi_book_study_frequencies f ON f.text_id=b.id`;
  if (!userId) return counts;

  // Only ignored tokens need their readings looked up at request time.
  return sql`
    WITH ignored AS MATERIALIZED (
      SELECT ch.text_id, CASE WHEN a.chapter_id IS NULL THEN to_jsonb(ARRAY[t.lemma_id])
        ELSE coalesce(r.entries,'[null]'::jsonb) END AS entries
      FROM reader_ignored_tokens i JOIN text_tokens t ON t.id=i.token_id AND t.is_word
      JOIN text_chapters ch ON ch.id=t.chapter_id JOIN (${books}) b ON b.id=ch.text_id
      LEFT JOIN hindi_chapter_analyses a ON a.chapter_id=ch.id
      LEFT JOIN LATERAL hindi_study_readings(a.chapter_id,t.idx) r ON true
      WHERE i.user_id=${userId}
    ), deductions AS (
      SELECT i.text_id,e.id::uuid AS lemma_id,
        sum(1::numeric/jsonb_array_length(i.entries)) AS occurrences, count(*) AS matches
      FROM ignored i CROSS JOIN LATERAL jsonb_array_elements_text(i.entries) e(id)
      GROUP BY i.text_id,e.id
    )
    SELECT f.text_id,f.lemma_id,f.occurrences-coalesce(d.occurrences,0) AS occurrences,
      f.matches-coalesce(d.matches,0) AS matches FROM (${counts}) f
    LEFT JOIN deductions d ON d.text_id=f.text_id AND f.lemma_id IS NOT DISTINCT FROM d.lemma_id
    WHERE f.matches>coalesce(d.matches,0)
  `;
}
