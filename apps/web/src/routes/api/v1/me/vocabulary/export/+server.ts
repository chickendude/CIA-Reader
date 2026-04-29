/**
 * GET /api/v1/me/vocabulary/export?language=hi (T-10.3).
 *
 * Returns a per-language CSV attachment for the authenticated user's touched
 * vocabulary: headword, pos, gloss, status.
 */
import { error } from '@sveltejs/kit';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  getVocabularyForExport,
  rowsToCsv,
} from '$lib/server/vocabulary.js';
import {
  isSupportedLanguage,
  type LanguageCode,
} from '@ciareader/shared-types';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const rawLanguage = event.url.searchParams.get('language');
  if (!rawLanguage) throw error(400, 'language is required');
  if (!isSupportedLanguage(rawLanguage)) {
    throw error(400, `Unsupported language '${rawLanguage}'`);
  }

  const language = rawLanguage as LanguageCode;
  const rows = await getVocabularyForExport(user.id, language);
  const csv = rowsToCsv(rows);

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="ciareader-vocabulary-${language}.csv"`,
      'cache-control': 'private, no-store',
    },
  });
};
