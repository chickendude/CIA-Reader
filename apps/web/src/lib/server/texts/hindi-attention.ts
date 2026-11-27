import { sql } from 'drizzle-orm';
import { liveTokenMatches } from '../dictionary/live-matches';
import { db, type DB } from '../db/index.js';
import { currentHindiChoiceStatus } from './hindi-context.js';

import type { ReviewFilter, ReviewStatus } from '$lib/dictionary/review-status';

type ReviewOccurrence = {
  id: string; chapter_id: string; chapter_idx: number; idx: number; start: number; stop: number;
  surface: string; status: ReviewStatus; ids: string[] | null;
};

async function loadReviewIndex(connection: Pick<DB, 'execute'>, textId: string) {
  // HindiDB reviews each word or phrase at its exact span. A longer phrase
  // starting at the same word is a separate occurrence.
  return connection.execute<ReviewOccurrence>(sql`
    WITH chapters AS MATERIALIZED (
      SELECT id,idx,md5(body) AS body_hash FROM text_chapters WHERE text_id=${textId}
    ), tokens AS MATERIALIZED (
      SELECT t.id,t.chapter_id,t.idx,t.surface,t.is_word,t.is_oov,t.lemma_id,t.lemma_candidates,
        (sum(char_length(t.surface)) OVER (PARTITION BY t.chapter_id ORDER BY t.idx)
          - char_length(t.surface))::int AS start
      FROM chapters ch JOIN text_tokens t ON t.chapter_id=ch.id
    ), readings AS (
      SELECT o.chapter_id,o.source_start AS start,o.source_end AS stop,o.lemma_id
      FROM hindi_occurrences o JOIN chapters ch ON ch.id=o.chapter_id
      UNION ALL
      SELECT t.chapter_id,t.start,t.start+char_length(t.surface),l.id
      FROM tokens t CROSS JOIN LATERAL (
        SELECT t.lemma_id AS id UNION SELECT (c->>'lemmaId')::uuid FROM jsonb_array_elements(t.lemma_candidates) c
      ) candidate JOIN lemmas l ON l.id=candidate.id
      WHERE t.is_word AND NOT EXISTS (
        SELECT 1 FROM hindi_chapter_analyses a WHERE a.chapter_id=t.chapter_id)
    ), spans AS MATERIALIZED (
      SELECT r.chapter_id,r.start,r.stop,jsonb_agg(DISTINCT r.lemma_id) AS ids,
        count(DISTINCT coalesce(h.entry->>'group_id',h.external_id,r.lemma_id::text)) AS choices
      FROM readings r LEFT JOIN hindi_entries h ON h.lemma_id=r.lemma_id
      GROUP BY r.chapter_id,r.start,r.stop
    ), saved AS (
      SELECT c.chapter_id,c.source_start AS start,c.source_end AS stop,
        ${currentHindiChoiceStatus(sql`coalesce(s.ids,'[]')`, sql`ch.body_hash`)} AS status
      FROM chapters ch JOIN hindi_context_choices c ON c.chapter_id=ch.id
      LEFT JOIN spans s ON s.chapter_id=c.chapter_id AND s.start=c.source_start AND s.stop=c.source_end
    ), decisions AS MATERIALIZED (
      SELECT DISTINCT ON (chapter_id,start,stop) chapter_id,start,stop,status FROM saved WHERE status IS NOT NULL
      ORDER BY chapter_id,start,stop,array_position(
        ARRAY['confirmed','ai_suggested','needs_review','uncertain','none_fit','unconfirmed'],status)
    ), merges AS (
      SELECT a.chapter_id,m.first,m.surface FROM chapters ch JOIN hindi_chapter_analyses a ON a.chapter_id=ch.id
      CROSS JOIN LATERAL jsonb_to_recordset(a.stats->'syllable_merges') m(first int,surface text)
    ), compound_tokens AS (
      SELECT DISTINCT o.chapter_id, part.idx FROM chapters ch JOIN hindi_occurrences o ON o.chapter_id=ch.id
      CROSS JOIN LATERAL generate_series(o.start_idx,o.end_idx-1) part(idx)
      WHERE o.end_idx>o.start_idx+1
    ), locations AS (
      SELECT chapter_id,start,stop FROM decisions
      UNION SELECT chapter_id,start,stop FROM spans WHERE choices>1
      UNION SELECT t.chapter_id,t.start,t.start+char_length(coalesce(m.surface,t.surface)) FROM tokens t
        LEFT JOIN merges m ON m.chapter_id=t.chapter_id AND m.first=t.idx WHERE t.is_word
    ), live AS (${liveTokenMatches(sql`SELECT ${textId}::uuid`)}), classified AS (
      SELECT t.id,t.idx,t.chapter_id,ch.idx AS chapter_idx,p.start,p.stop,t.surface,s.ids,
        CASE WHEN d.status IS NOT NULL AND d.status<>'unconfirmed' THEN d.status
          WHEN s.choices>1 THEN 'unconfirmed'
          WHEN s.ids IS NULL AND covered.idx IS NULL AND t.is_word AND p.stop=p.start+char_length(t.surface)
            AND i.surface IS NULL AND NOT EXISTS (SELECT FROM live WHERE token_id=t.id)
            AND (t.is_oov OR EXISTS (
              SELECT 1 FROM hindi_chapter_analyses a WHERE a.chapter_id=t.chapter_id))
            THEN 'unparsed' END AS status
      FROM locations p JOIN tokens t USING (chapter_id,start)
      JOIN chapters ch ON ch.id=p.chapter_id
      LEFT JOIN spans s USING (chapter_id,start,stop)
      LEFT JOIN decisions d USING (chapter_id,start,stop)
      LEFT JOIN compound_tokens covered ON covered.chapter_id=t.chapter_id AND covered.idx=t.idx
      LEFT JOIN hindi_review_ignored i ON i.text_id=${textId} AND i.surface=t.surface
    ), reviewable AS (
      SELECT c.id,c.chapter_id,c.chapter_idx,c.idx,c.start,c.stop,c.status,c.ids,
        CASE WHEN c.stop=c.start+char_length(c.surface) THEN c.surface
          ELSE substr(ch.body,c.start+1,c.stop-c.start) END AS surface
      FROM classified c JOIN text_chapters ch ON ch.id=c.chapter_id
      WHERE c.status IS NOT NULL
    )
    SELECT * FROM reviewable
    ORDER BY array_position(ARRAY['needs_review','uncertain','none_fit','unconfirmed','unparsed','ai_suggested','confirmed'],status),
      chapter_idx,idx,stop`);
}

// The cache holds book data shared by reviewers. Permissions and reader corrections
// are checked separately for each request.
const indexes = new Map<string, { version: string; rows: ReturnType<typeof loadReviewIndex> }>();

async function reviewIndex(connection: Pick<DB, 'execute'>, textId: string) {
  const [state] = await connection.execute<{ version: string }>(sql`
    SELECT jsonb_build_array(
      (SELECT revision FROM hindi_dictionary_state WHERE id=1),
      (SELECT jsonb_agg(jsonb_build_array(id,idx,hindi_review_revision) ORDER BY idx)
       FROM text_chapters WHERE text_id=${textId}),
      (SELECT jsonb_agg(surface ORDER BY surface) FROM hindi_review_ignored WHERE text_id=${textId})
    )::text AS version`);
  const version = state!.version;
  const cached = indexes.get(textId);
  indexes.delete(textId);
  if (cached?.version === version) {
    indexes.set(textId, cached);
    return cached.rows;
  }
  const rows = loadReviewIndex(connection, textId);
  indexes.set(textId, { version, rows });
  if (indexes.size > 3) indexes.delete(indexes.keys().next().value!);
  try {
    const result = await rows;
    if (result.length > 100_000 && indexes.get(textId)?.rows === rows) indexes.delete(textId);
    return result;
  } catch (error) {
    if (indexes.get(textId)?.rows === rows) indexes.delete(textId);
    throw error;
  }
}

export async function bookAttention(textId: string, userId: string, query: string, offset: number, filter: ReviewFilter) {
  // A concurrent edit must not put new occurrences under an older version.
  const [index, ignored] = await db.transaction(async tx => Promise.all([
    reviewIndex(tx, textId),
    tx.execute<{ token_id: string }>(sql`SELECT i.token_id FROM reader_ignored_tokens i
      JOIN text_tokens t ON t.id=i.token_id JOIN text_chapters c ON c.id=t.chapter_id
      WHERE i.user_id=${userId} AND c.text_id=${textId}`),
  ]), {
    isolationLevel: 'repeatable read', accessMode: 'read only',
  });
  const needle = query.toLowerCase();
  const ignoredIds = new Set(ignored.map(row => row.token_id));
  const counts: Partial<Record<ReviewFilter, number>> & { attention: number } = { attention: 0 };
  const matches: ReviewOccurrence[] = [];
  for (const row of index) {
    if (ignoredIds.has(row.id)) continue;
    if (needle && !row.surface.toLowerCase().includes(needle)) continue;
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    const needsAttention = row.status !== 'ai_suggested' && row.status !== 'confirmed';
    if (needsAttention) counts.attention++;
    if (filter === 'attention' ? needsAttention : row.status === filter) {
      matches.push(row);
    }
  }
  const total = matches.length;
  offset = Math.min(offset, Math.max(0, Math.ceil(total / 20) - 1) * 20);
  return { counts, total, offset, rows: matches.slice(offset, offset + 20) };
}
