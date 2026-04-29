/**
 * Bulk text reprocess service (T-6.8).
 *
 * After a large dictionary import or a batch of override updates,
 * already-ingested texts may benefit from a fresh NLP pass. The
 * single-text endpoint at `POST /api/v1/admin/texts/:id/reprocess`
 * (T-4.4) handles individual recoveries; this service walks the
 * whole library (filterable by language and status) and triggers
 * re-processing on each.
 *
 * Synchronous-feeling but fire-and-forget per text: we call
 * `processTextNow` on every match, but DON'T await each one — the
 * dispatcher is async and the caller wants the count of dispatched
 * jobs, not the eventual completion. A background process owns the
 * actual work; the API is ack-only.
 */
import { and, eq, inArray } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type { Text } from '../db/schema.js';
import type { LanguageCode } from '@ciareader/shared-types';
import { processTextNow } from './in-process-dispatcher.js';

export type BulkReprocessFilter = {
  language?: LanguageCode;
  /** Filter by current text status. Common: 'ready' (re-run after
   *  override updates), 'failed' (recover stuck imports). */
  statuses?: Array<Text['status']>;
  /** Cap on number of texts to re-process in one call. Defaults
   *  to 500 — high enough for batch dictionary imports, low enough
   *  that a stray invocation doesn't pin the worker for hours. */
  limit?: number;
};

export type BulkReprocessResult = {
  /** How many texts matched the filter. */
  matched: number;
  /** How many we actually dispatched (matched, capped to `limit`). */
  dispatched: number;
  textIds: string[];
};

export async function bulkReprocessTexts(
  filter: BulkReprocessFilter,
): Promise<BulkReprocessResult> {
  const limit = Math.min(Math.max(1, filter.limit ?? 500), 5000);
  const conditions = [];
  if (filter.language) {
    conditions.push(eq(schema.texts.language, filter.language));
  }
  if (filter.statuses && filter.statuses.length > 0) {
    conditions.push(
      inArray(
        schema.texts.status,
        filter.statuses as unknown as Text['status'][],
      ),
    );
  }
  let q = db.select({ id: schema.texts.id }).from(schema.texts).$dynamic();
  if (conditions.length > 0) {
    q = q.where(and(...(conditions as Parameters<typeof and>))) as typeof q;
  }
  const rows = (await q.limit(limit)) as Array<{ id: string }>;

  const textIds = rows.map((r) => r.id);
  // Fire-and-forget — the dispatcher writes status flips back to
  // the texts row so the library / reader poll endpoints surface
  // progress. We deliberately don't `await` so a 100-text batch
  // doesn't tie up the request thread.
  for (const id of textIds) {
    void processTextNow(id).catch((err) => {
      // Background failure: log + move on. The text's row will
      // reflect the failure via markTextFailed in the dispatcher.
      console.error(`bulkReprocessTexts: ${id} failed:`, err);
    });
  }

  return {
    matched: textIds.length,
    dispatched: textIds.length,
    textIds,
  };
}
