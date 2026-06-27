/**
 * User-created dictionary lemmas.
 *
 * The Primeran subtitle-mining extension lets a user attach a personal
 * translation to any word — including words the dictionary doesn't have a lemma
 * for yet (out-of-vocabulary surface forms the parser lemmatized). Personal
 * translations key off a lemma id, so this get-or-creates a lemma for
 * (language, headword) first, marked `source: 'user'`. Returns an existing
 * dictionary lemma untouched if one already exists, so we never duplicate.
 */
import { and, eq } from 'drizzle-orm';

import { LANGUAGES, type LanguageCode } from '@ciareader/shared-types';

import { db, schema } from '../db/index.js';
import type { Lemma } from '../db/schema.js';

export const MAX_HEADWORD_LEN = 120;

export class UserLemmaError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 = 400,
  ) {
    super(message);
    this.name = 'UserLemmaError';
  }
}

export type EnsureLemmaInput = {
  /** Reserved for provenance / future rate limiting. */
  userId: string;
  language: LanguageCode;
  headword: string;
  /** UD UPOS-ish tag; defaults to `X` (unspecified) when the caller has none. */
  pos?: string | null;
};

/** Get-or-create a lemma for (language, headword). Existing entries (any POS)
 *  are returned as-is; otherwise a new `source: 'user'` lemma is inserted. */
export async function ensureUserLemma(input: EnsureLemmaInput): Promise<Lemma> {
  const headword = input.headword.normalize('NFC').trim();
  if (!headword) throw new UserLemmaError('headword cannot be empty');
  if (headword.length > MAX_HEADWORD_LEN) {
    throw new UserLemmaError(`headword exceeds ${MAX_HEADWORD_LEN} characters`);
  }

  const [existing] = await db
    .select()
    .from(schema.lemmas)
    .where(and(eq(schema.lemmas.language, input.language), eq(schema.lemmas.headword, headword)))
    .limit(1);
  if (existing) return existing as Lemma;

  const pos = input.pos?.trim() || 'X';
  const script = LANGUAGES[input.language].script;
  const [row] = await db
    .insert(schema.lemmas)
    .values({
      language: input.language,
      headword,
      pos,
      script,
      source: 'user',
      glossDefault: null,
      frequencyRank: null,
    })
    .returning();
  if (!row) throw new Error('Failed to insert lemma');
  return row as Lemma;
}
