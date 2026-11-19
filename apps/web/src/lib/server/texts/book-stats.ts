import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';

export type BookWordStats = {
  words: number;
  uniqueWords: number;
  unresolved: number;
  unparsedWords: number;
  knownWords: number;
  learningWords: number;
  knownPct: number | null;
  learningPct: number | null;
  uniquePct: number | null;
};

// A Hindi word can match several entries before a context choice assigns it to one.
export function unparsedWordCount(textIds: SQL) {
  return sql`(
    SELECT coalesce(sum(coalesce(a.unresolved_words, f.occurrences)), 0)::int
    FROM text_chapters ch LEFT JOIN hindi_chapter_analyses a ON a.chapter_id = ch.id
    LEFT JOIN chapter_word_frequencies f ON f.chapter_id = ch.id AND f.lemma_id IS NULL
    WHERE ch.text_id IN (${textIds})
  )`;
}

// The entries relation contains one frequency per book and dictionary entry, including unresolved words.
export function scoreBookEntries(userId?: string) {
  return sql`
    SELECT e.id, sum(e.n)::int AS words, count(e.lemma_id)::int AS "uniqueWords",
      coalesce(sum(e.n) FILTER (WHERE e.lemma_id IS NULL), 0)::int AS unresolved,
      coalesce(sum(e.n) FILTER (WHERE k.status = 'known'), 0)::int AS "knownWords",
      coalesce(sum(e.n) FILTER (WHERE k.status = 'learning'), 0)::int AS "learningWords",
      count(*) FILTER (WHERE k.status = 'known')::int AS known_entries,
      CASE WHEN ${userId ?? null}::uuid IS NOT NULL THEN
        coalesce(sum(e.n) FILTER (WHERE k.status = 'known'), 0) / sum(e.n) END AS reading_ratio,
      CASE WHEN ${userId ?? null}::uuid IS NOT NULL THEN
        coalesce(sum(e.n) FILTER (WHERE k.status IN ('known', 'learning')), 0) / sum(e.n) END AS learning_ratio,
      CASE WHEN ${userId ?? null}::uuid IS NOT NULL THEN
        count(*) FILTER (WHERE k.status = 'known')::numeric / nullif(count(e.lemma_id), 0) END AS unique_ratio
    FROM entries e LEFT JOIN user_known_lemmas k ON k.lemma_id = e.lemma_id AND k.user_id = ${userId ?? null}::uuid
    GROUP BY e.id
  `;
}

export async function libraryBookStats(textIds: string[], collectionIds: string[], userId?: string): Promise<Record<string, BookWordStats>> {
  if (!textIds.length && !collectionIds.length) return {};
  const members = [];
  if (textIds.length) members.push(sql`
    SELECT id, id AS text_id FROM texts WHERE id IN (${sql.join(textIds.map(id => sql`${id}`), sql`, `)})
  `);
  if (collectionIds.length) members.push(sql`
    SELECT collection_id AS id, text_id FROM collection_items
    WHERE collection_id IN (${sql.join(collectionIds.map(id => sql`${id}`), sql`, `)})
  `);
  const rows = await db.execute<BookWordStats & { id: string }>(sql`
    WITH members AS (${sql.join(members, sql` UNION ALL `)}), entries AS (
      SELECT m.id, f.lemma_id, sum(f.occurrences) AS n FROM members m
      JOIN book_word_frequencies f ON f.text_id = m.text_id GROUP BY m.id, f.lemma_id
    ), scores AS (${scoreBookEntries(userId)})
    SELECT id, words, "uniqueWords", unresolved,
      ${unparsedWordCount(sql`SELECT m.text_id FROM members m WHERE m.id = scores.id`)} AS "unparsedWords",
      "knownWords", "learningWords", round(100 * reading_ratio, 1)::float8 AS "knownPct",
      round(100 * learning_ratio, 1)::float8 AS "learningPct", round(100 * unique_ratio, 1)::float8 AS "uniquePct"
    FROM scores
  `);
  return Object.fromEntries(rows.map(({ id, ...stats }) => [id, stats]));
}
