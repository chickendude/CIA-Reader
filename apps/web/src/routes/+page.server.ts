/**
 * Home loader (T-5.12).
 *
 * Used to be a diagnostic dashboard; the redesign turns it into the
 * language-pick landing. Loads:
 *   - SUPPORTED_LANGUAGE_CODES + LANGUAGES descriptors (always)
 *   - Per-user known-word counts from `user_languages.knownWordsCountCache`
 *     when a user is signed in. The cache is refreshed by the
 *     known-lemmas write path (T-5.5) so this read is a single
 *     primary-key lookup per language with no GROUP BY.
 *   - NLP health passthrough — kept in the loader so /debug or future
 *     status surfaces can read it without a second request.
 */
import { eq } from 'drizzle-orm';

import { db } from '$lib/server/db/index.js';
import { userLanguages } from '$lib/server/db/schema.js';
import { nlpClient } from '$lib/server/nlp-client.js';
import {
  LANGUAGES,
  SUPPORTED_LANGUAGE_CODES,
  type LanguageCode,
} from '@ciareader/shared-types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  let nlpStatus: 'ok' | 'down' = 'down';
  let nlpLanguages: string[] = [];
  try {
    const health = await nlpClient.health();
    nlpStatus = health.status === 'ok' ? 'ok' : 'down';
    nlpLanguages = health.languages;
  } catch (err) {
    console.error('NLP health check failed:', err);
  }

  const knownByLanguage: Partial<Record<LanguageCode, number>> = {};
  if (locals.user) {
    const rows = await db
      .select({
        language: userLanguages.language,
        knownWordsCountCache: userLanguages.knownWordsCountCache,
      })
      .from(userLanguages)
      .where(eq(userLanguages.userId, locals.user.id));
    for (const r of rows) {
      knownByLanguage[r.language as LanguageCode] = r.knownWordsCountCache;
    }
  }

  return {
    nlpStatus,
    nlpLanguages,
    languages: SUPPORTED_LANGUAGE_CODES.map((code) => ({
      code,
      displayName: LANGUAGES[code].displayName,
      nativeName: LANGUAGES[code].nativeName,
      script: LANGUAGES[code].script,
      known: knownByLanguage[code] ?? 0,
    })),
    user: locals.user
      ? {
          id: locals.user.id,
          email: locals.user.email,
          displayName: locals.user.displayName,
          role: locals.user.role,
        }
      : null,
  };
};
