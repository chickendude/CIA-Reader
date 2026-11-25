import { and, eq, inArray } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type { Text } from '../db/schema.js';
import type { LanguageCode } from '@ciareader/shared-types';
import { processTextNow } from './in-process-dispatcher.js';
import { reprocessPdfText } from './pdf-page.js';

type ReprocessText = Pick<Text, 'id' | 'sourceType'>;
const pending = new Map<string, ReprocessText>();
const running = new Set<string>();

// One book can write thousands of tokens per chapter. Leave database connections available
// for readers while a batch overlaps NLP for one book with database work for another.
const MAX_RUNNING_BOOKS = 2;

async function runQueuedText(text: ReprocessText) {
  try {
    if (text.sourceType === 'pdf') await reprocessPdfText(text.id);
    else await processTextNow(text.id);
  } catch (error) {
    console.error(`Reprocessing text ${text.id} failed`, error);
  } finally {
    running.delete(text.id);
    startQueuedTexts();
  }
}

function startQueuedTexts() {
  for (const [id, text] of pending) {
    if (running.size >= MAX_RUNNING_BOOKS) break;
    pending.delete(id);
    running.add(id);
    void runQueuedText(text);
  }
}

export function queueReprocessTexts(texts: ReprocessText[]): string[] {
  const added = [];
  for (const text of texts) {
    if (pending.has(text.id) || running.has(text.id)) continue;
    pending.set(text.id, text);
    added.push(text.id);
  }
  startQueuedTexts();
  return added;
}

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
  /** How many matching texts were selected within the requested limit. */
  matched: number;
  /** How many were newly queued by this request. */
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
  let q = db.select({ id: schema.texts.id, sourceType: schema.texts.sourceType }).from(schema.texts).$dynamic();
  if (conditions.length > 0) {
    q = q.where(and(...(conditions as Parameters<typeof and>))) as typeof q;
  }
  const rows = await q.limit(limit);
  const textIds = queueReprocessTexts(rows);
  return {
    matched: rows.length,
    dispatched: textIds.length,
    textIds,
  };
}
