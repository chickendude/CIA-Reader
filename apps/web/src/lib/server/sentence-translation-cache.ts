/**
 * DB-backed cache for OpenAI sentence translations. Global (not per-user),
 * keyed by (language, targetLanguage, model, sha256(sentence)). Best-effort:
 * a missing table or DB error is a miss / write no-op, so translation still
 * works (just uncached) until the migration is applied.
 */
import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { db, schema } from './db/index.js';

export function hashSentence(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export type TranslationKey = {
  language: string;
  targetLanguage: string;
  model: string;
  textHash: string;
};

export async function getCachedTranslation(key: TranslationKey): Promise<string | null> {
  try {
    const [row] = await db
      .select({ translation: schema.sentenceTranslations.translation })
      .from(schema.sentenceTranslations)
      .where(
        and(
          eq(schema.sentenceTranslations.language, key.language),
          eq(schema.sentenceTranslations.targetLanguage, key.targetLanguage),
          eq(schema.sentenceTranslations.model, key.model),
          eq(schema.sentenceTranslations.textHash, key.textHash),
        ),
      )
      .limit(1);
    return row?.translation ?? null;
  } catch {
    return null;
  }
}

export async function setCachedTranslation(
  key: TranslationKey,
  text: string,
  translation: string,
): Promise<void> {
  try {
    await db
      .insert(schema.sentenceTranslations)
      .values({ ...key, text, translation })
      .onConflictDoUpdate({
        target: [
          schema.sentenceTranslations.language,
          schema.sentenceTranslations.targetLanguage,
          schema.sentenceTranslations.model,
          schema.sentenceTranslations.textHash,
        ],
        set: { translation },
      });
  } catch {
    // best-effort write
  }
}
