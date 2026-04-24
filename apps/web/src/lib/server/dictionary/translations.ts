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
    public readonly status: 400 | 404 | 409 = 400,
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
    .select({ id: schema.translations.id, lemmaId: schema.translations.lemmaId })
    .from(schema.translations)
    .where(eq(schema.translations.id, parentId))
    .limit(1);
  if (!row) {
    throw new TranslationValidationError(
      `parentTranslationId ${parentId} not found`,
      404,
    );
  }
  if (row.lemmaId !== lemmaId) {
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
      lemmaId: input.lemmaId,
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

export function publicTranslation(row: Translation) {
  return {
    id: row.id,
    lemmaId: row.lemmaId,
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
