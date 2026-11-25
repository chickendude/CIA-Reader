import { readerFrequencies } from './reader-frequencies';
import { sql } from 'drizzle-orm';
import type { LanguageCode } from '@ciareader/shared-types';
import { schema } from '../db/index.js';

export const NOT_A_CHAPTER_BOOK_MEMBER = sql`NOT EXISTS (
  SELECT 1 FROM collection_items ci
  INNER JOIN collections c ON c.id = ci.collection_id
  WHERE ci.text_id = ${schema.texts.id}
    AND c.kind = 'chapter_book'
)`;

export function officialCatalog(language?: LanguageCode, userId?: string) {
  return sql`
      SELECT texts.id, texts.title, texts.language, texts.source_type::text AS "sourceType",
        texts.status::text, texts.visibility, texts.created_at, NULL::int AS "chapterCount",
        coalesce(texts.owner_id = ${userId ?? null}, false) AS "isOwner"
      FROM texts WHERE visibility='official' AND ${NOT_A_CHAPTER_BOOK_MEMBER}
        ${language ? sql`AND language=${language}` : sql``}
      UNION ALL
      SELECT c.id,c.title,c.language,'book','','official',c.created_at,
        (SELECT count(*)::int FROM collection_items ci WHERE ci.collection_id=c.id),
        coalesce(c.owner_id = ${userId ?? null}, false)
      FROM collections c WHERE visibility='official' AND kind='chapter_book'
        ${language ? sql`AND language=${language}` : sql``}
  `;
}

// The caller supplies a candidates relation with the catalog titles to score.
export function catalogEntries(userId?: string) {
  return sql`
      SELECT c.id, f.lemma_id, f.occurrences AS n FROM candidates c
      JOIN ${readerFrequencies('book', userId)} f ON f.text_id=c.id
      WHERE c."chapterCount" IS NULL
      UNION ALL
      SELECT c.id, f.lemma_id, sum(f.occurrences) AS n FROM candidates c
      JOIN collection_items ci ON ci.collection_id=c.id
      JOIN ${readerFrequencies('book', userId)} f ON f.text_id=ci.text_id
      WHERE c."chapterCount" IS NOT NULL
      GROUP BY c.id,f.lemma_id
`;
}
