import { sql } from 'drizzle-orm';
import { db } from '../db/index';
import type { ReviewItem } from '$lib/dictionary/hindi-workshop';

export async function workshopQueue(
  actor: string,
  book: string | null,
  kind: string,
  query: string,
  limit: number,
) {
  const pattern = '%' + query.replace(/[\\%_]/g, '\\$&') + '%';
  const rows = await db.execute<ReviewItem & { total: number }>(sql`
    WITH books AS (SELECT id FROM texts WHERE language='hi' AND (owner_id=${actor} OR visibility='official')
      AND (${book}::uuid IS NULL OR id=${book}::uuid)),
    items AS (
      SELECT t.surface word,NULL::uuid id,CASE WHEN i.surface IS NULL THEN 'unresolved' ELSE 'ignored' END kind,
        c.text_id book,c.idx chapter,t.idx token,t.chapter_id,t.sentence_idx
      FROM books b JOIN text_chapters c ON c.text_id=b.id JOIN text_tokens t ON t.chapter_id=c.id
      LEFT JOIN hindi_review_ignored i ON i.text_id=b.id AND i.surface=t.surface
      WHERE t.is_word AND t.is_oov AND t.surface ILIKE ${pattern}
      UNION ALL
      SELECT l.headword,l.id,'missing-definition',c.text_id,c.idx,t.idx,t.chapter_id,t.sentence_idx
      FROM books b JOIN text_chapters c ON c.text_id=b.id JOIN hindi_occurrences o ON o.chapter_id=c.id
      JOIN lemmas l ON l.id=o.lemma_id JOIN text_tokens t ON t.chapter_id=c.id AND t.idx=o.start_idx
      WHERE nullif(l.gloss_default,'') IS NULL AND l.headword ILIKE ${pattern}
    ), grouped AS (
      SELECT word,id,kind,count(*)::int count,(array_agg(book ORDER BY book,chapter,token))[1] book,
        (array_agg(chapter_id ORDER BY book,chapter,token))[1] chapter_id,
        (array_agg(chapter ORDER BY book,chapter,token))[1] chapter,
        (array_agg(token ORDER BY book,chapter,token))[1] token,
        (array_agg(sentence_idx ORDER BY book,chapter,token))[1] sentence
      FROM items WHERE ${kind ? sql`kind=${kind}` : sql`kind<>'ignored'`}
      GROUP BY word,id,kind
    ), page AS (SELECT *,count(*) OVER()::int total FROM grouped ORDER BY count DESC,word,id LIMIT ${limit})
    SELECT p.word,p.id,p.kind,p.count,p.book,p.chapter,p.token,p.total,
      coalesce((SELECT string_agg(surface,'' ORDER BY idx) FROM text_tokens
        WHERE chapter_id=p.chapter_id AND sentence_idx=p.sentence AND idx BETWEEN p.token-32 AND p.token+32),'') context
    FROM page p ORDER BY p.count DESC,p.word,p.id`);
  return { rows: [...rows], total: rows[0]?.total ?? 0 };
}
