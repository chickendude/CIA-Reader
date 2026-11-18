import { error, json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireUser } from '$lib/server/auth/require-user.js';
import { db } from '$lib/server/db/index.js';
import type { RequestHandler } from './$types';

const input = z.object({
  apply: z.boolean(),
  ignoredIds: z.array(z.string().min(1).max(200)).max(100000).default([]),
  entries: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        status: z.enum(['unknown', 'learning', 'known']),
      }),
    )
    .max(100000),
});

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const parsed = input.safeParse(await event.request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'Invalid Anki entries');
  const { entries, ignoredIds, apply } = parsed.data;
  if (new Set(entries.map((e) => e.id)).size !== entries.length)
    throw error(400, 'Duplicate entry IDs');
  const result = await db.transaction(async (tx) => {
    if (apply) await tx.execute(sql`SELECT id FROM users WHERE id=${user.id} FOR UPDATE`);
    const rows = await tx.execute<{
      id: string;
      status: string;
      lemma_id: string | null;
      previous: string | null;
    }>(sql`
      WITH aliases AS (
        SELECT a.id,h.lemma_id FROM hindi_entries h
        CROSS JOIN LATERAL jsonb_array_elements_text(h.entry->'merged_entry_ids') a(id)
        WHERE h.entry ? 'merged_entry_ids'
      ), unique_aliases AS (
        SELECT id,min(lemma_id::text)::uuid AS lemma_id FROM aliases GROUP BY id HAVING count(DISTINCT lemma_id)=1
      ), requested AS (
        SELECT e.id, e.status FROM jsonb_to_recordset(${JSON.stringify(entries)}::text::jsonb) AS e(id text,status text)
        UNION ALL
        SELECT id, NULL::text FROM jsonb_array_elements_text(${JSON.stringify(ignoredIds)}::text::jsonb) AS skipped(id)
      ), resolved AS (
        SELECT r.id, r.status, coalesce(h.lemma_id,a.lemma_id) AS lemma_id
        FROM requested r
        LEFT JOIN hindi_entries h ON h.external_id=r.id
        LEFT JOIN unique_aliases a ON a.id=r.id AND h.lemma_id IS NULL
      )
      SELECT r.id, r.status, r.lemma_id, v.status::text AS previous
      FROM resolved r
      LEFT JOIN user_known_lemmas v ON v.lemma_id=r.lemma_id AND v.user_id=${user.id}
      WHERE r.status IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM resolved skipped WHERE skipped.status IS NULL AND skipped.lemma_id=r.lemma_id
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
        SELECT ${user.id},e.lemma_id,e.status::known_lemma_status
        FROM jsonb_to_recordset(${JSON.stringify(changes)}::text::jsonb) AS e(lemma_id uuid,status text)
        ON CONFLICT(user_id,lemma_id) DO UPDATE SET status=excluded.status,updated_at=now()`);
      await tx.execute(sql`UPDATE user_languages SET known_words_count_cache=(
        SELECT count(*) FROM user_known_lemmas v JOIN lemmas l ON l.id=v.lemma_id
        WHERE v.user_id=${user.id} AND l.language='hi' AND v.status='known')
        WHERE user_id=${user.id} AND language='hi'`);
    }
    const unmatched = rows.filter((r) => !r.lemma_id).map((r) => r.id);
    return {
      changes: changes.length,
      matched: byLemma.size,
      unmatched,
      counts: Object.fromEntries(
        ['unknown', 'learning', 'known'].map((s) => [
          s,
          changes.filter((r) => r.status === s).length,
        ]),
      ),
    };
  });
  return json(result);
};
