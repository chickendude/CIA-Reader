/**
 * Dictionary-edit audit log (T-3.4).
 *
 * `recordLemmaEdit` is the single write path into `lemma_edit_history`.
 * The editor UI (T-3.7) + moderation queue (T-6.6) never write that
 * table directly — they call through here so the before/after diff
 * and enum discriminator stay consistent.
 *
 * Reason was previously required (min 3 chars) — the requirement was
 * dropped because in a small-team / solo curator setup the friction
 * outweighed the audit value, and the field was being filled with
 * `"x"` / `"fix"` to bypass anyway. Empty/missing reasons now write
 * a `'(no reason given)'` placeholder so the audit chain stays
 * unbroken; `MissingReasonError` is kept exported for backwards-
 * compat with existing call sites + tests, but is never thrown.
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

/** Kept exported for backwards-compat with call sites that still
 *  catch it. `recordLemmaEdit` / `recordPhraseEdit` no longer throw
 *  this — empty reasons fall through to the placeholder. */
export class MissingReasonError extends Error {
  constructor() {
    super('A reason is required for every curator edit');
    this.name = 'MissingReasonError';
  }
}

/** Placeholder used when the caller doesn't supply a reason. Keeps
 *  the audit row's `reason` non-empty so the editor's history list
 *  has something to render. */
export const NO_REASON_PLACEHOLDER = '(no reason given)';

function normalizeReason(raw: string | null | undefined): string {
  const trimmed = raw?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : NO_REASON_PLACEHOLDER;
}

export async function recordLemmaEdit(
  input: RecordLemmaEditInput,
): Promise<LemmaEditHistoryEntry> {
  const reason = normalizeReason(input.reason);
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
  const reason = normalizeReason(input.reason);
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
