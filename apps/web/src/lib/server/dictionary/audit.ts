/**
 * Dictionary-edit audit log (T-3.4).
 *
 * `recordLemmaEdit` is the single write path into `lemma_edit_history`.
 * The editor UI (T-3.7) + moderation queue (T-6.6) never write that
 * table directly — they call through here so the before/after diff,
 * required reason, and enum discriminator stay consistent.
 *
 * T-14.7: phrase audit rows live in the same table — `recordPhraseEdit`
 * is the parallel write path, setting `phrase_id` and leaving
 * `lemma_id` null. The DB CHECK constraint (`lemma_id XOR phrase_id`)
 * keeps the table honest.
 */
import { desc, eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type { LemmaEditHistoryEntry, LemmaEditChangePayload } from '../db/schema.js';

export type LemmaEditChangeType = typeof schema.lemmaEditChangeType.enumValues[number];

export type RecordLemmaEditInput = {
  lemmaId: string;
  editorId: string;
  changeType: LemmaEditChangeType;
  change: LemmaEditChangePayload;
  reason: string;
};

export type RecordPhraseEditInput = {
  phraseId: string;
  editorId: string;
  changeType: LemmaEditChangeType;
  change: LemmaEditChangePayload;
  reason: string;
};

export class MissingReasonError extends Error {
  constructor() {
    super('A reason is required for every curator edit');
    this.name = 'MissingReasonError';
  }
}

const MIN_REASON_LEN = 3;

export async function recordLemmaEdit(
  input: RecordLemmaEditInput,
): Promise<LemmaEditHistoryEntry> {
  const reason = input.reason?.trim() ?? '';
  if (reason.length < MIN_REASON_LEN) {
    throw new MissingReasonError();
  }
  const [row] = await db
    .insert(schema.lemmaEditHistory)
    .values({
      lemmaId: input.lemmaId,
      editorId: input.editorId,
      changeType: input.changeType,
      change: input.change,
      reason,
    })
    .returning();
  if (!row) throw new Error('Failed to insert audit row');
  return row as LemmaEditHistoryEntry;
}

/**
 * Fetch recent history for one lemma (newest first). The editor shows
 * these in a sidebar; 50 is more than any single lemma realistically
 * churns through in a sitting.
 */
export async function listLemmaHistory(
  lemmaId: string,
  limit = 50,
): Promise<LemmaEditHistoryEntry[]> {
  const rows = await db
    .select()
    .from(schema.lemmaEditHistory)
    .where(eq(schema.lemmaEditHistory.lemmaId, lemmaId))
    .orderBy(desc(schema.lemmaEditHistory.createdAt))
    .limit(limit);
  return rows as LemmaEditHistoryEntry[];
}

/**
 * T-14.7: phrase audit write path. Mirror of `recordLemmaEdit`,
 * sets `phrase_id` instead of `lemma_id`. The DB CHECK constraint
 * (`lemma_id XOR phrase_id`) makes "exactly one set" a database
 * invariant rather than a TS type one.
 */
export async function recordPhraseEdit(
  input: RecordPhraseEditInput,
): Promise<LemmaEditHistoryEntry> {
  const reason = input.reason?.trim() ?? '';
  if (reason.length < MIN_REASON_LEN) {
    throw new MissingReasonError();
  }
  const [row] = await db
    .insert(schema.lemmaEditHistory)
    .values({
      lemmaId: null,
      phraseId: input.phraseId,
      editorId: input.editorId,
      changeType: input.changeType,
      change: input.change,
      reason,
    })
    .returning();
  if (!row) throw new Error('Failed to insert audit row');
  return row as LemmaEditHistoryEntry;
}

/**
 * T-14.7: parallel to `listLemmaHistory` for phrase audit rows.
 * Filters on `phrase_id` so the curator phrase editor (T-14.4a)
 * can render the same sidebar shape.
 */
export async function listPhraseHistory(
  phraseId: string,
  limit = 50,
): Promise<LemmaEditHistoryEntry[]> {
  const rows = await db
    .select()
    .from(schema.lemmaEditHistory)
    .where(eq(schema.lemmaEditHistory.phraseId, phraseId))
    .orderBy(desc(schema.lemmaEditHistory.createdAt))
    .limit(limit);
  return rows as LemmaEditHistoryEntry[];
}
