/**
 * User-submitted translation service (T-3.2).
 *
 * Wraps the minimum surface needed by the public `POST /api/v1/translations`
 * endpoint: input validation against the schema, existence checks for the
 * referenced lemma + optional parent translation, and the final insert.
 *
 * Deliberately NOT rate-limited: saving a definition is the reader's core
 * annotation loop, so a per-user ceiling here caps ordinary studying (an
 * active session saves a definition for most new words). Abuse of the
 * shared dictionary is handled downstream by moderation (hide/unhide,
 * reports — which have their own submitter cap in `moderation/reports.ts`)
 * rather than by throttling saves.
 */
import { eq, inArray } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type { Translation } from '../db/schema.js';

/**
 * `MAX_BODY_LEN`: keep submissions sentence-sized. Dictionary glosses
 * don't need paragraphs; anything longer is usually noise or abuse.
 */
export const MAX_BODY_LEN = 500;

export type SubmitTranslationInput = {
  lemmaId: string;
  body: string;
  parentTranslationId?: string | null;
  targetLanguage?: string;
  /** A private note is visible only to its author. */
  isPrivate?: boolean;
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

/**
 * Resolve the lemma a forked personal note should attach to, validating the
 * fork along the way. "Customize" copies an official/community entry the reader
 * saw for this word — but that entry can live on a *sibling* lemma: the parser
 * tags the tapped token under one POS while the dictionary entry sits under
 * another (or, in messy data, under a duplicate same-headword lemma), and the
 * reader surfaces it via the same-headword fallback in `getLemmaTranslations`.
 * Pinning the note to the parent's own lemma keeps the fork with the entry it
 * copied and preserves the invariant that a parent and its child share a
 * target. Returns the lemma id to write the note against.
 */
async function resolveForkTargetLemma(
  parentId: string,
  requestedLemmaId: string,
): Promise<string> {
  const [parent] = await db
    .select({
      // T-14.7a: parent-target check via the polymorphic columns so the
      // legacy lemma_id column can be dropped.
      targetType: schema.translations.targetType,
      targetId: schema.translations.targetId,
    })
    .from(schema.translations)
    .where(eq(schema.translations.id, parentId))
    .limit(1);
  if (!parent) {
    throw new TranslationValidationError(
      `parentTranslationId ${parentId} not found`,
      404,
    );
  }
  // A phrase-target parent can't be forked onto a lemma.
  if (parent.targetType !== 'lemma') {
    throw new TranslationValidationError(
      'parentTranslationId belongs to a different lemma',
    );
  }
  // The common case: the parent lives on the tapped lemma. No extra lookup.
  if (parent.targetId === requestedLemmaId) return requestedLemmaId;

  // Different lemma: allow it only when the parent sits on a same-word sibling
  // (same headword + language) — the fallback-surfaced entry the reader really
  // saw — and attach the note there so the guard's row invariant holds. Any
  // other lemma is a cross-word fork and stays rejected.
  const lemmaRows = await db
    .select({
      id: schema.lemmas.id,
      headword: schema.lemmas.headword,
      language: schema.lemmas.language,
    })
    .from(schema.lemmas)
    .where(inArray(schema.lemmas.id, [parent.targetId, requestedLemmaId]));
  const parentLemma = lemmaRows.find((r) => r.id === parent.targetId);
  const requestedLemma = lemmaRows.find((r) => r.id === requestedLemmaId);
  if (
    parentLemma &&
    requestedLemma &&
    parentLemma.headword === requestedLemma.headword &&
    parentLemma.language === requestedLemma.language
  ) {
    return parent.targetId;
  }
  throw new TranslationValidationError(
    'parentTranslationId belongs to a different lemma',
  );
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
): Promise<Translation> {
  const { body, targetLanguage } = validateInput(input);
  await assertLemmaExists(input.lemmaId);
  // A fork inherits the parent entry's lemma — which may be a same-word sibling
  // the reader saw via the fallback — so the note lands with the entry it
  // copied instead of being rejected for living on a different lemma.
  const targetLemmaId = input.parentTranslationId
    ? await resolveForkTargetLemma(input.parentTranslationId, input.lemmaId)
    : input.lemmaId;

  const [row] = await db
    .insert(schema.translations)
    .values({
      // T-14.7a: legacy lemma_id column dropped — inserts now
      // write only the polymorphic (target_type, target_id)
      // pair. The reader / popup / export / merge surfaces all
      // moved to that pair in this PR's read-site sweep.
      targetType: 'lemma',
      targetId: targetLemmaId,
      source: 'user',
      submittedBy: userId,
      parentTranslationId: input.parentTranslationId ?? null,
      body,
      targetLanguage,
      // Officials carry an attribution string and an upstream id; user
      // submissions carry neither.
      sourceAttribution: null,
      sourceId: null,
      isPrivate: input.isPrivate ?? false,
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
  isPrivate?: boolean;
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
 * Insert a new user-submitted *phrase* translation. Same body
 * validation as the lemma path. Writes `lemma_id=NULL`,
 * `target_type='phrase'`, `target_id=phraseId`.
 */
export async function submitUserPhraseTranslation(
  userId: string,
  input: SubmitPhraseTranslationInput,
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
      isPrivate: input.isPrivate ?? false,
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
 * Toggling `isPrivate` is just a display change — flipping a note
 * public/private, not a new submission.
 */
export async function updateUserTranslation(
  userId: string,
  translationId: string,
  patch: { body?: string; isPrivate?: boolean },
  now: Date = new Date(),
): Promise<Translation> {
  let normalizedBody: string | undefined;
  if (patch.body !== undefined) {
    normalizedBody = normalizeBody(patch.body);
    if (normalizedBody.length === 0) {
      throw new TranslationValidationError('Translation body cannot be empty');
    }
    if (normalizedBody.length > MAX_BODY_LEN) {
      throw new TranslationValidationError(
        `Translation body exceeds ${MAX_BODY_LEN} characters`,
      );
    }
  }
  if (normalizedBody === undefined && patch.isPrivate === undefined) {
    throw new TranslationValidationError('Nothing to update');
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
    .set({
      ...(normalizedBody !== undefined && { body: normalizedBody }),
      ...(patch.isPrivate !== undefined && { isPrivate: patch.isPrivate }),
      updatedAt: now,
    })
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
    isPrivate: row.isPrivate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
