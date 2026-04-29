/**
 * /stats/:language — per-language learning stats (T-10.1).
 *
 * Auth-gated; aggregates the user's known/learning lemma counts +
 * per-text and per-collection comprehension breakdowns.
 */
import { error, redirect } from '@sveltejs/kit';

import {
  getLanguageStats,
  listCollectionStats,
  listTextStats,
} from '$lib/server/learning-stats.js';
import {
  LANGUAGES,
  isSupportedLanguage,
  type LanguageCode,
} from '@ciareader/shared-types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
  if (!locals.user) {
    throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
  }
  const lang = params.language;
  if (!lang || !isSupportedLanguage(lang)) {
    throw error(400, `Unsupported language '${lang}'`);
  }
  const language = lang as LanguageCode;

  const [stats, texts, collections] = await Promise.all([
    getLanguageStats(locals.user.id, language),
    listTextStats(locals.user.id, language),
    listCollectionStats(locals.user.id, language),
  ]);

  return {
    language,
    languageDescriptor: {
      code: LANGUAGES[language].code,
      displayName: LANGUAGES[language].displayName,
      nativeName: LANGUAGES[language].nativeName,
    },
    stats,
    texts,
    collections,
  };
};
