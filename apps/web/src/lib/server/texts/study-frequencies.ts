import { ignoredWords, readerFrequencies } from './reader-frequencies';
import type { LanguageCode } from '@ciareader/shared-types';
import { sql, type SQL } from 'drizzle-orm';

// Prefer a valid context choice, then the shortest lexical span covering the word.
// Split its single occurrence evenly if that span still has several possible readings.
export function studyFrequencies(books: SQL, language: LanguageCode, userId?: string) {
  if (language !== 'hi') return sql`
    SELECT f.text_id, f.lemma_id, f.occurrences, f.occurrences AS matches
    FROM (${books}) b JOIN ${readerFrequencies('book', userId)} f ON f.text_id = b.id
  `;
  return sql`
    WITH books AS (${books}), chapters AS MATERIALIZED (
      SELECT ch.id, ch.text_id, md5(ch.body) AS body_hash, a.unresolved_words
        ${userId ? sql`- (SELECT count(*)::int FROM (${ignoredWords(userId)}) i WHERE i.chapter_id=ch.id AND i.unparsed)` : sql``} AS unresolved_words
      FROM books b JOIN text_chapters ch ON ch.text_id = b.id
      LEFT JOIN hindi_chapter_analyses a ON a.chapter_id = ch.id
    ), spans AS (
      SELECT o.chapter_id, o.start_idx, o.end_idx, o.source_start, o.source_end,
        array_agg(o.lemma_id ORDER BY o.lemma_id) AS entries
      FROM chapters ch JOIN hindi_occurrences o ON o.chapter_id = ch.id
      WHERE ch.unresolved_words IS NOT NULL
      GROUP BY o.chapter_id, o.source_start, o.source_end, o.start_idx, o.end_idx
    ), choices AS MATERIALIZED (
      SELECT c.chapter_id, c.source_start, c.source_end, c.status, c.source_occurrence_id,
        c.selected_lemma_ids, c.candidate_lemma_ids
      FROM chapters ch JOIN hindi_context_choices c ON c.chapter_id = ch.id
      WHERE c.status IN ('confirmed', 'ai_suggested') AND c.selected_lemma_ids <> '[]'
        AND c.metadata->>'chapter_hash' = ch.body_hash
    ), covered_tokens AS MATERIALIZED (
      SELECT s.chapter_id, generate_series(s.start_idx, s.end_idx - 1) AS idx,
        s.start_idx, s.end_idx, s.source_end, c.status, c.source_occurrence_id,
        coalesce(c.selected_lemma_ids, to_jsonb(s.entries)) AS entries
      FROM spans s
      LEFT JOIN choices c ON c.chapter_id = s.chapter_id
        AND c.source_start = s.source_start AND c.source_end = s.source_end
        AND c.candidate_lemma_ids @> to_jsonb(s.entries) AND to_jsonb(s.entries) @> c.candidate_lemma_ids
        AND to_jsonb(s.entries) @> c.selected_lemma_ids
    ), word_matches AS (
      SELECT DISTINCT ON (m.chapter_id, m.idx) ch.text_id, m.entries
      FROM covered_tokens m
      JOIN text_tokens t ON t.chapter_id = m.chapter_id AND t.idx = m.idx AND t.is_word
      JOIN chapters ch ON ch.id = m.chapter_id
      ${userId ? sql`WHERE NOT EXISTS (SELECT 1 FROM reader_ignored_tokens i WHERE i.token_id=t.id AND i.user_id=${userId})` : sql``}
      ORDER BY m.chapter_id, m.idx, (m.status IS NULL), m.end_idx - m.start_idx,
        m.start_idx, m.source_end, (m.status = 'confirmed') DESC, m.source_occurrence_id
    ), grouped AS (
      SELECT text_id, entries, count(*) AS words FROM word_matches GROUP BY text_id, entries
    )
    SELECT g.text_id, entry.id::uuid AS lemma_id, sum(g.words::numeric / jsonb_array_length(g.entries)) AS occurrences,
      sum(g.words) AS matches
    FROM grouped g CROSS JOIN LATERAL jsonb_array_elements_text(g.entries) entry(id)
    GROUP BY g.text_id, entry.id
    UNION ALL
    SELECT text_id, NULL::uuid, sum(unresolved_words), sum(unresolved_words) FROM chapters
    WHERE unresolved_words > 0 GROUP BY text_id
    UNION ALL
    SELECT ch.text_id, f.lemma_id, f.occurrences, f.occurrences FROM chapters ch
    JOIN ${readerFrequencies('chapter', userId)} f ON f.chapter_id = ch.id WHERE ch.unresolved_words IS NULL
  `;
}
