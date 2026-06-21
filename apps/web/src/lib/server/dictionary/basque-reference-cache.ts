/**
 * DB-backed global cache for the admin Basque reference lookups.
 *
 * One row per (word, source) in `basque_reference_cache`, shared across all
 * admins and server restarts, so the proprietary upstream sites
 * (Elhuyar / Euskaltzaindia) are hit at most once per word per TTL window
 * rather than on every popup open. The cached content is still only ever
 * served back through the admin-gated reference endpoint — never written to
 * `translations`, never shown to readers.
 *
 * Every operation is best-effort: if the table is missing (migration not yet
 * applied) or the DB hiccups, a read is treated as a miss and a write is a
 * no-op, so the lookup degrades to a live fetch instead of failing.
 */
import { and, eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type {
  BasqueReferenceResult,
  BasqueReferenceSource,
  ReferenceCache,
} from './basque-reference.js';

export const dbReferenceCache: ReferenceCache = {
  async get(word: string, source: BasqueReferenceSource) {
    try {
      const [row] = await db
        .select()
        .from(schema.basqueReferenceCache)
        .where(
          and(
            eq(schema.basqueReferenceCache.word, word),
            eq(schema.basqueReferenceCache.source, source),
          ),
        )
        .limit(1);
      if (!row) return null;
      return {
        results: row.results as BasqueReferenceResult[],
        fetchedAt: row.fetchedAt.getTime(),
      };
    } catch {
      return null; // table missing / transient DB error → treat as a miss
    }
  },

  async set(
    word: string,
    source: BasqueReferenceSource,
    results: BasqueReferenceResult[],
    now: number,
  ) {
    try {
      await db
        .insert(schema.basqueReferenceCache)
        .values({ word, source, results, fetchedAt: new Date(now) })
        .onConflictDoUpdate({
          target: [schema.basqueReferenceCache.word, schema.basqueReferenceCache.source],
          set: { results, fetchedAt: new Date(now) },
        });
    } catch {
      // Best-effort write — a cache miss next time is fine; never break the
      // lookup because the cache couldn't be persisted.
    }
  },
};
