/**
 * User-submitted translation service (T-3.2).
 *
 * Wraps the minimum surface needed by the public `POST /api/v1/translations`
 * endpoint: input validation against the schema, existence checks for the
 * referenced lemma + optional parent translation, per-user rate limiting
 * against a rolling window, and the final insert.
 *
 * Rate-limit strategy is deliberately simple: count rows in `translations`
 * with `submittedBy = userId AND createdAt > now() - window`. A Postgres
 * index on `submitted_by` already exists (T-3.1) so the count is cheap
 * even once the table is large. We'll graduate to a Redis bucket in M11
 * if the DB cost becomes real; until then the simpler approach is
 * easier to reason about and leaves an auditable trail.
 */
import { and, count, eq, gt } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type { Translation } from '../db/schema.js';

/**
 * Hard ceilings for user-submitted translations.
 *
 * - `MAX_BODY_LEN`: keep submissions sentence-sized. Dictionary glosses
 *   don't need paragraphs; anything longer is usually noise or abuse.
 * - `MAX_PER_USER_PER_WINDOW` / `WINDOW_MS`: soft deterrent against
 *   translation-spam bots. Legitimate users don't submit 30+ translations
 *   per hour.
 */
export const MAX_BODY_LEN = 500;
export const MAX_PER_USER_PER_WINDOW = 30;
export const WINDOW_MS = 60 * 60 * 1_000; // 1 hour

export type SubmitTranslationInput = {
  lemmaId: string;
  body: string;
  parentTranslationId?: string | null;
  targetLanguage?: string;
};

export class TranslationValidationError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'TranslationValidationError';
  }
}

export class TranslationRateLimitError extends Error {
  constructor(
    public readonly retryAfterSeconds: number,
    public readonly limit: number = MAX_PER_USER_PER_WINDOW,
  ) {
    super('Translation submission rate limit exceeded');
    this.name = 'TranslationRateLimitError';
  }
}

function normalizeBody(body: string): string {
  // Strip leading/trailing whitespace and collapse internal runs so
  // "  to  speak  " doesn't get stored verbatim.
  return body.trim().replace(/\s+/g, ' ');
}

function validateInput(input: SubmitTranslationInput): {
  body: string;
  targetLanguage: string;
} {
  const body = normalizeBody(input.body ?? '');
  if (body.length === 0) {
    throw new TranslationValidationError('Translation body cannot be empty');
  }
  if (body.length > MAX_BODY_LEN) {
    throw new TranslationValidationError(
      `Translation body exceeds ${MAX_BODY_LEN} characters`,
    );
  }
  const targetLanguage = (input.targetLanguage ?? 'en').toLowerCase();
  // ISO-639-1/2-ish: two or three ASCII letters. Good enough to reject
  // obvious garbage while not needing a full registry enum at MVP.
  if (!/^[a-z]{2,3}$/.test(targetLanguage)) {
    throw new TranslationValidationError(
      'targetLanguage must be a 2- or 3-letter ISO language code',
    );
  }
  return { body, targetLanguage };
}

async function assertLemmaExists(lemmaId: string): Promise<void> {
  const [row] = await db
    .select({ id: schema.lemmas.id })
    .from(schema.lemmas)
    .where(eq(schema.lemmas.id, lemmaId))
    .limit(1);
  if (!row) {
    throw new TranslationValidationError(`Lemma ${lemmaId} not found`, 404);
  }
}

async function assertParentBelongsToLemma(
  parentId: string,
  lemmaId: string,
): Promise<void> {
  const [row] = await db
    .select({
      id: schema.translations.id,
      // T-14.7a: parent-target check via the polymorphic columns
      // so the legacy lemma_id column can be dropped. A phrase-
      // target parent forking onto a lemma is rejected here for
      // the same reason it was when this used `lemmaId !== ...`
      // — the customize-fork mechanic is per-target.
      targetType: schema.translations.targetType,
      targetId: schema.translations.targetId,
    })
    .from(schema.translations)
    .where(eq(schema.translations.id, parentId))
    .limit(1);
  if (!row) {
    throw new TranslationValidationError(
      `parentTranslationId ${parentId} not found`,
      404,
    );
  }
  if (row.targetType !== 'lemma' || row.targetId !== lemmaId) {
    throw new TranslationValidationError(
      'parentTranslationId belongs to a different lemma',
    );
  }
}

async function assertUnderRateLimit(userId: string, now: Date): Promise<void> {
  const since = new Date(now.getTime() - WINDOW_MS);
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(schema.translations)
    .where(
      and(
        eq(schema.translations.submittedBy, userId),
        gt(schema.translations.createdAt, since),
      ),
    );
  if (Number(n) >= MAX_PER_USER_PER_WINDOW) {
    throw new TranslationRateLimitError(Math.ceil(WINDOW_MS / 1_000));
  }
}

/**
 * Insert a new user-submitted translation.
 *
 * The endpoint layer (and this service) guarantee `source='user'` and
 * `submittedBy=userId`, so a caller cannot impersonate an official
 * import by hand. `parentTranslationId` is how T-3.5 will implement
 * "customize an official translation"; the parent is kept for display
 * provenance only — the fork is a real, independently-editable row.
 *
 * T-14.1: writes are polymorphic-aware. For lemma-target rows the
 * row carries both `lemma_id` (legacy column, still NOT NULL via
 * default behaviour for callers but column-level NULLability flipped
 * for phrase rows) and `target_type='lemma'` / `target_id=lemma_id`.
 * Phrase-target submissions go through `submitUserPhraseTranslation`.
 */
export async function submitUserTranslation(
  userId: string,
  input: SubmitTranslationInput,
  now: Date = new Date(),
): Promise<Translation> {
  const { body, targetLanguage } = validateInput(input);
  await assertLemmaExists(input.lemmaId);
  if (input.parentTranslationId) {
    await assertParentBelongsToLemma(input.parentTranslationId, input.lemmaId);
  }
  await assertUnderRateLimit(userId, now);

  const [row] = await db
    .insert(schema.translations)
    .values({
      // T-14.7a: legacy lemma_id column dropped — inserts now
      // write only the polymorphic (target_type, target_id)
      // pair. The reader / popup / export / merge surfaces all
      // moved to that pair in this PR's read-site sweep.
      targetType: 'lemma',
      targetId: input.lemmaId,
      source: 'user',
      submittedBy: userId,
      parentTranslationId: input.parentTranslationId ?? null,
      body,
      targetLanguage,
      // Officials carry an attribution string and an upstream id; user
      // submissions carry neither.
      sourceAttribution: null,
      sourceId: null,
    })
    .returning();
  if (!row) throw new Error('Failed to insert translation');
  return row as Translation;
}

// -----------------------------------------------------------------------
// Phrase-target translations (T-14.1).
// -----------------------------------------------------------------------

export type SubmitPhraseTranslationInput = {
  phraseId: string;
  body: string;
  parentTranslationId?: string | null;
  targetLanguage?: string;
};

async function assertPhraseExists(phraseId: string): Promise<void> {
  const [row] = await db
    .select({ id: schema.phrases.id })
    .from(schema.phrases)
    .where(eq(schema.phrases.id, phraseId))
    .limit(1);
  if (!row) {
    throw new TranslationValidationError(`Phrase ${phraseId} not found`, 404);
  }
}

async function assertParentBelongsToPhrase(
  parentId: string,
  phraseId: string,
): Promise<void> {
  const [row] = await db
    .select({
      id: schema.translations.id,
      targetType: schema.translations.targetType,
      targetId: schema.translations.targetId,
    })
    .from(schema.translations)
    .where(eq(schema.translations.id, parentId))
    .limit(1);
  if (!row) {
    throw new TranslationValidationError(
      `parentTranslationId ${parentId} not found`,
      404,
    );
  }
  if (row.targetType !== 'phrase' || row.targetId !== phraseId) {
    throw new TranslationValidationError(
      'parentTranslationId belongs to a different target',
    );
  }
}

/**
 * Insert a new user-submitted *phrase* translation. Same rate-limit
 * window and body validation as the lemma path — sharing
 * `assertUnderRateLimit` is intentional so a translation-spam bot
 * can't dodge the cap by alternating between targets. Writes
 * `lemma_id=NULL`, `target_type='phrase'`, `target_id=phraseId`.
 */
export async function submitUserPhraseTranslation(
  userId: string,
  input: SubmitPhraseTranslationInput,
  now: Date = new Date(),
): Promise<Translation> {
  const { body, targetLanguage } = validateInput({
    lemmaId: 'unused',
    body: input.body,
    targetLanguage: input.targetLanguage,
  });
  await assertPhraseExists(input.phraseId);
  if (input.parentTranslationId) {
    await assertParentBelongsToPhrase(
      input.parentTranslationId,
      input.phraseId,
    );
  }
  await assertUnderRateLimit(userId, now);

  const [row] = await db
    .insert(schema.translations)
    .values({
      // T-14.7a: legacy lemma_id column dropped — phrase-target
      // inserts have always set lemma_id=null; that field is
      // gone now and we only write the polymorphic pair.
      targetType: 'phrase',
      targetId: input.phraseId,
      source: 'user',
      submittedBy: userId,
      parentTranslationId: input.parentTranslationId ?? null,
      body,
      targetLanguage,
      sourceAttribution: null,
      sourceId: null,
    })
    .returning();
  if (!row) throw new Error('Failed to insert translation');
  return row as Translation;
}

/**
 * Edit the body of one of the caller's own user-submitted translations
 * (T-3.5). Guards:
 *   - Row must exist.
 *   - Row must have `source='user'` (we never mutate officials in-place —
 *     those go through the curator dictionary editor instead).
 *   - Row's `submittedBy` must match the caller.
 *   - New body must pass the same validation as a fresh submit.
 *
 * Not rate-limited: edits are cheap, and the real abuse vector (spam)
 * is already bounded at create time.
 */
export async function updateUserTranslation(
  userId: string,
  translationId: string,
  patch: { body: string },
  now: Date = new Date(),
): Promise<Translation> {
  const body = normalizeBody(patch.body ?? '');
  if (body.length === 0) {
    throw new TranslationValidationError('Translation body cannot be empty');
  }
  if (body.length > MAX_BODY_LEN) {
    throw new TranslationValidationError(
      `Translation body exceeds ${MAX_BODY_LEN} characters`,
    );
  }
  const [existing] = await db
    .select()
    .from(schema.translations)
    .where(eq(schema.translations.id, translationId))
    .limit(1);
  if (!existing) {
    throw new TranslationValidationError(
      `Translation ${translationId} not found`,
      404,
    );
  }
  const row = existing as Translation;
  if (row.source !== 'user' || row.submittedBy !== userId) {
    throw new TranslationValidationError(
      'You can only edit your own translations',
      403,
    );
  }
  const [updated] = await db
    .update(schema.translations)
    .set({ body, updatedAt: now })
    .where(eq(schema.translations.id, translationId))
    .returning();
  if (!updated) throw new Error('Failed to update translation');
  return updated as Translation;
}

/**
 * Hard-delete one of the caller's own user-submitted translations
 * (T-3.5). Curator/admin moderation uses `hidden=true` instead so the
 * audit trail survives; the author themselves can just remove the row.
 */
export async function deleteUserTranslation(
  userId: string,
  translationId: string,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(schema.translations)
    .where(eq(schema.translations.id, translationId))
    .limit(1);
  if (!existing) {
    throw new TranslationValidationError(
      `Translation ${translationId} not found`,
      404,
    );
  }
  const row = existing as Translation;
  if (row.source !== 'user' || row.submittedBy !== userId) {
    throw new TranslationValidationError(
      'You can only delete your own translations',
      403,
    );
  }
  await db
    .delete(schema.translations)
    .where(eq(schema.translations.id, translationId));
}

export function publicTranslation(row: Translation) {
  return {
    id: row.id,
    // T-14.7a: dropped the legacy `lemmaId` field; clients have
    // had T-14.1's `targetType` / `targetId` to read from for
    // months. Phrase-target rows distinguish themselves via
    // `targetType === 'phrase'`.
    targetType: row.targetType,
    targetId: row.targetId,
    source: row.source,
    submittedBy: row.submittedBy,
    parentTranslationId: row.parentTranslationId,
    body: row.body,
    targetLanguage: row.targetLanguage,
    sourceAttribution: row.sourceAttribution,
    hidden: row.hidden,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
