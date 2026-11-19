import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from './db/index.js';

export const ankiImportInput = z.object({
  apply: z.boolean(),
  ignoredIds: z.array(z.string().min(1).max(200)).max(100000).default([]),
  entries: z
    .array(
      z
        .object({
          parhibaId: z.string().min(1).max(200).optional(),
          id: z.string().min(1).max(200).optional(),
          headword: z.string().trim().min(1).max(500).optional(),
          status: z.enum(['unknown', 'learning', 'known', 'ignore']),
        })
        .refine((e) => e.parhibaId || e.id || e.headword),
    )
    .max(100000),
});

export async function importAnkiVocabulary(
  userId: string,
  { apply, entries, ignoredIds }: z.infer<typeof ankiImportInput>,
) {
  return db.transaction(async (tx) => {
    if (apply) await tx.execute(sql`SELECT id FROM users WHERE id=${userId} FOR UPDATE`);
    const rows = await tx.execute<{
      id: string;
      status: string;
      headword: string | null;
      parhiba_id: string | null;
      lemma_id: string | null;
      previous: string | null;
    }>(sql`
      WITH requested AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(entries)}::text::jsonb)
          AS e("parhibaId" text, id text, headword text, status text)
        UNION ALL
        SELECT NULL, id, NULL, 'ignore' FROM jsonb_array_elements_text(${JSON.stringify(ignoredIds)}::text::jsonb) AS skipped(id)
      ), matched AS (
        SELECT r.*, coalesce(l.id, word.id) AS lemma_id
        FROM requested r
        LEFT JOIN lemmas l ON l.language='hi' AND l.id::text=lower(r."parhibaId")
        LEFT JOIN lemmas word ON l.id IS NULL AND word.language='hi'
          AND normalize(word.headword, NFC)=normalize(r.headword, NFC)
      ), aliases AS (
        SELECT a.id, min(h.lemma_id::text)::uuid AS lemma_id
        FROM hindi_entries h
        CROSS JOIN LATERAL jsonb_array_elements_text(h.entry->'merged_entry_ids') a(id)
        WHERE h.entry ? 'merged_entry_ids' AND a.id IN (SELECT id FROM matched WHERE lemma_id IS NULL)
        GROUP BY a.id HAVING count(DISTINCT h.lemma_id)=1
      ), resolved AS (
        SELECT coalesce(m."parhibaId", m.id, m.headword) AS id, m.status, m.headword, m."parhibaId" AS parhiba_id,
          coalesce(m.lemma_id, h.lemma_id, a.lemma_id) AS lemma_id
        FROM matched m
        LEFT JOIN hindi_entries h ON m.lemma_id IS NULL AND h.external_id=m.id
        LEFT JOIN aliases a ON m.lemma_id IS NULL AND a.id=m.id
      )
      SELECT r.id, r.status, r.headword, r.parhiba_id, r.lemma_id, v.status::text AS previous
      FROM resolved r
      LEFT JOIN user_known_lemmas v ON v.lemma_id=r.lemma_id AND v.user_id=${userId}
      WHERE r.status <> 'ignore' AND NOT EXISTS (
        SELECT 1 FROM resolved skipped WHERE skipped.status='ignore' AND skipped.lemma_id=r.lemma_id
      )`);
    const rank = ['unknown', 'learning', 'known'];
    const byLemma = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!row.lemma_id) continue;
      const prior = byLemma.get(row.lemma_id);
      if (!prior || rank.indexOf(row.status) > rank.indexOf(prior.status))
        byLemma.set(row.lemma_id, row);
    }
    const changes = [...byLemma.values()].filter((r) => r.status !== r.previous);
    if (apply && changes.length) {
      await tx.execute(sql`INSERT INTO user_known_lemmas(user_id,lemma_id,status)
        SELECT ${userId},e.lemma_id,e.status::known_lemma_status
        FROM jsonb_to_recordset(${JSON.stringify(changes)}::text::jsonb) AS e(lemma_id uuid,status text)
        ON CONFLICT(user_id,lemma_id) DO UPDATE SET status=excluded.status,updated_at=now()`);
      await tx.execute(sql`UPDATE user_languages SET known_words_count_cache=(
        SELECT count(*) FROM user_known_lemmas v JOIN lemmas l ON l.id=v.lemma_id
        WHERE v.user_id=${userId} AND l.language='hi' AND v.status='known')
        WHERE user_id=${userId} AND language='hi'`);
    }
    const skipped = rows.filter((row) => !row.lemma_id);
    return {
      changes: changes.length,
      matched: byLemma.size,
      unmatched: [...new Set(skipped.map((row) => row.id))],
      unmatchedEntries: skipped.map((row) => ({ headword: row.headword, parhibaId: row.parhiba_id })),
      counts: Object.fromEntries(
        ['unknown', 'learning', 'known'].map((s) => [
          s,
          changes.filter((r) => r.status === s).length,
        ]),
      ),
    };
  });
}
