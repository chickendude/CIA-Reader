import { sql } from 'drizzle-orm';
import { db } from '../db/index';
import type { ReviewItem } from '$lib/dictionary/hindi-workshop';

export async function workshopQueue(
  actor: string,
  book: string | null,
  kind: string,
  query: string,
  limit: number,
  offset = 0,
) {
  const pattern = '%' + query.replace(/[\\%_]/g, '\\$&') + '%';
  const rows = await db.execute<ReviewItem & { total: number }>(sql`
    WITH books AS (SELECT id FROM texts WHERE language='hi' AND (owner_id=${actor} OR visibility='official')
      AND (${book}::uuid IS NULL OR id=${book}::uuid)),
    items AS (
      SELECT t.surface word,NULL::uuid id,CASE WHEN i.surface IS NULL THEN 'unresolved' ELSE 'ignored' END kind,
        c.text_id book,c.idx chapter,t.idx token,t.chapter_id
      FROM books b JOIN text_chapters c ON c.text_id=b.id JOIN text_tokens t ON t.chapter_id=c.id
      LEFT JOIN hindi_review_ignored i ON i.text_id=b.id AND i.surface=t.surface
      WHERE t.is_word AND t.is_oov AND t.surface ILIKE ${pattern}
      UNION ALL
      SELECT l.headword,l.id,'missing-definition',c.text_id,c.idx,t.idx,t.chapter_id
      FROM books b JOIN text_chapters c ON c.text_id=b.id JOIN hindi_occurrences o ON o.chapter_id=c.id
      JOIN lemmas l ON l.id=o.lemma_id JOIN text_tokens t ON t.chapter_id=c.id AND t.idx=o.start_idx
      WHERE nullif(l.gloss_default,'') IS NULL AND l.headword ILIKE ${pattern}
    ), per_book AS (
      SELECT word,id,kind,book,count(*)::int count,
        (array_agg(chapter_id ORDER BY chapter,token))[1] chapter_id,
        (array_agg(chapter ORDER BY chapter,token))[1] chapter,
        (array_agg(token ORDER BY chapter,token))[1] token
      FROM items WHERE ${kind ? sql`kind=${kind}` : sql`kind<>'ignored'`}
      GROUP BY word,id,kind,book
    ), page AS (
      SELECT word,id,kind,sum(count)::int count,count(*) OVER()::int total
      FROM per_book GROUP BY word,id,kind
      ORDER BY count DESC,word,id,kind LIMIT ${limit} OFFSET ${offset}
    )
    SELECT p.*, (SELECT pos FROM lemmas WHERE id=p.id) pos, jsonb_agg(jsonb_build_object(
      'book',b.book,'chapter',b.chapter,'token',b.token,'count',b.count,'context',
      (SELECT string_agg(surface,'' ORDER BY idx) FROM text_tokens
       WHERE chapter_id=b.chapter_id AND idx BETWEEN b.token-32 AND b.token+32)
    ) ORDER BY b.count DESC,b.book) samples
    FROM page p JOIN per_book b ON b.word=p.word AND b.kind=p.kind AND b.id IS NOT DISTINCT FROM p.id
    GROUP BY p.word,p.id,p.kind,p.count,p.total ORDER BY p.count DESC,p.word,p.id,p.kind`);
  return { rows: [...rows], total: rows[0]?.total ?? 0 };
}
