import type { LanguageCode } from '@ciareader/shared-types';
import { sql } from 'drizzle-orm';
import { db } from '../db/index';
import type { ReviewItem } from '$lib/dictionary/workshop';
import { SENTENCE_END_RE } from '../texts/sentences';

export async function workshopQueue(
  actor: string,
  book: string | null,
  kind: string,
  query: string,
  limit: number,
  offset = 0,
  language: LanguageCode = 'hi',
) {
  const pattern = '%' + query.replace(/[\\%_]/g, '\\$&') + '%';
  const boundary = `${SENTENCE_END_RE.source}|\n[[:space:]]*\n`;
  const rows = await db.execute<ReviewItem & { total: number }>(sql`
    WITH books AS (SELECT id FROM texts WHERE language=${language} AND (owner_id=${actor} OR visibility='official')
      AND (${book}::uuid IS NULL OR id=${book}::uuid)),
    items AS (
      SELECT t.surface word,NULL::uuid id,CASE WHEN i.surface IS NULL THEN 'unresolved' ELSE 'ignored' END kind,
        c.text_id book,c.idx chapter,t.idx token,t.idx + 1 end_token,t.chapter_id,
        ''::text occurrence,NULL::integer source_start,NULL::text body_hash
      FROM books b JOIN text_chapters c ON c.text_id=b.id JOIN text_tokens t ON t.chapter_id=c.id
      LEFT JOIN hindi_review_ignored i ON i.text_id=b.id AND i.surface=t.surface
      WHERE t.is_word AND t.is_oov AND t.surface ILIKE ${pattern}
      UNION ALL
      SELECT l.headword,l.id,'missing-definition',c.text_id,c.idx,t.idx,o.end_idx,t.chapter_id,'',NULL,NULL
      FROM books b JOIN text_chapters c ON c.text_id=b.id JOIN hindi_occurrences o ON o.chapter_id=c.id
      JOIN lemmas l ON l.id=o.lemma_id JOIN text_tokens t ON t.chapter_id=c.id AND t.idx=o.start_idx
      WHERE nullif(l.gloss_default,'') IS NULL AND l.headword ILIKE ${pattern}
      UNION ALL
      SELECT l.headword,l.id,'missing-definition',c.text_id,c.idx,t.idx,t.idx+1,c.id,'',NULL,NULL
      FROM books b JOIN text_chapters c ON c.text_id=b.id JOIN text_tokens t ON t.chapter_id=c.id
      CROSS JOIN LATERAL (SELECT DISTINCT value->>'lemmaId' AS id
        FROM jsonb_array_elements(t.lemma_candidates) AS value
        UNION SELECT t.lemma_id::text) candidate
      JOIN lemmas l ON l.id=candidate.id::uuid AND l.language=${language}
      WHERE nullif(l.gloss_default,'') IS NULL AND l.headword ILIKE ${pattern}
        AND NOT EXISTS (SELECT 1 FROM hindi_chapter_analyses a WHERE a.chapter_id=c.id)
      UNION ALL
      SELECT s->>'surface',NULL::uuid,'stutter',b.id,c.idx,(s->>'first')::int,(s->>'word')::int+1,c.id,
        c.id::text||':'||(s->>'start'),(s->>'start')::int,a.stats->>'stutter_text_hash'
      FROM books b JOIN text_chapters c ON c.text_id=b.id JOIN hindi_chapter_analyses a ON a.chapter_id=c.id
      CROSS JOIN LATERAL jsonb_array_elements(a.stats->'stutters') s
      WHERE s->>'status'='pending' AND s->>'surface' ILIKE ${pattern}
    ), ignored_occurrences AS (
      SELECT t.chapter_id,t.idx FROM reader_ignored_tokens i
      JOIN text_tokens t ON t.id=i.token_id WHERE i.user_id=${actor}
    ), per_book AS (
      SELECT word,id,kind,book,occurrence,min(source_start) source_start,min(body_hash) body_hash,count(*)::int count,
        (array_agg(chapter_id ORDER BY chapter,token))[1] chapter_id,
        (array_agg(chapter ORDER BY chapter,token))[1] chapter,
        (array_agg(token ORDER BY chapter,token))[1] token,
        (array_agg(end_token ORDER BY chapter,token,end_token DESC))[1] end_token
      FROM items WHERE ${kind ? sql`kind=${kind}` : sql`kind<>'ignored'`}
        AND (kind='stutter' OR NOT EXISTS (SELECT 1 FROM ignored_occurrences i
          WHERE i.chapter_id=items.chapter_id AND i.idx=items.token))
      GROUP BY word,id,kind,book,occurrence
    ), page AS (
      SELECT word,id,kind,occurrence,sum(count)::int count,count(*) OVER()::int total
      FROM per_book GROUP BY word,id,kind,occurrence
      ORDER BY count DESC,word,id,kind,occurrence LIMIT ${limit} OFFSET ${offset}
    )
    SELECT p.*, (SELECT pos FROM lemmas WHERE id=p.id) pos, jsonb_agg(jsonb_build_object(
      'chapterId',b.chapter_id,'start',b.source_start,'hash',b.body_hash,'book',b.book,'chapter',b.chapter,'token',b.token,'count',b.count,'context',
      (SELECT jsonb_build_object(
         'before', coalesce(string_agg(surface,'' ORDER BY idx) FILTER (WHERE idx < b.token),''),
         'match', string_agg(surface,'' ORDER BY idx) FILTER (WHERE idx >= b.token AND idx < b.end_token),
         'after', coalesce(string_agg(surface,'' ORDER BY idx) FILTER (WHERE idx >= b.end_token),'')
       ) FROM text_tokens WHERE chapter_id=b.chapter_id
         AND idx > coalesce((SELECT idx FROM text_tokens WHERE chapter_id=b.chapter_id
           AND idx < b.token AND surface ~ ${boundary} ORDER BY idx DESC LIMIT 1), -1)
         AND idx <= coalesce((SELECT idx FROM text_tokens WHERE chapter_id=b.chapter_id
           AND idx >= b.end_token AND surface ~ ${boundary} ORDER BY idx LIMIT 1), 2147483647))
    ) ORDER BY b.count DESC,b.book) samples
    FROM page p JOIN per_book b ON b.word=p.word AND b.kind=p.kind AND b.occurrence=p.occurrence AND b.id IS NOT DISTINCT FROM p.id
    GROUP BY p.word,p.id,p.kind,p.count,p.total,p.occurrence ORDER BY p.count DESC,p.word,p.id,p.kind,p.occurrence`);
  return { rows: [...rows], total: rows[0]?.total ?? 0 };
}
