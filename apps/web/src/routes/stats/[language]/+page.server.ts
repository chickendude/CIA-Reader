/**
 * /stats/:language — per-language learning stats (T-10.1).
 *
 * Auth-gated; aggregates the user's known/learning lemma counts +
 * per-text and per-collection comprehension breakdowns.
 */
import { error, redirect } from '@sveltejs/kit';

import {
  STATS_DEFAULT_PAGE_SIZE,
  clampStatsPage,
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

function readInt(url: URL, key: string, fallback: number): number {
  const raw = url.searchParams.get(key);
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const load: PageServerLoad = async ({ params, locals, url }) => {
  if (!locals.user) {
    throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
  }
  const lang = params.language;
  if (!lang || !isSupportedLanguage(lang)) {
    throw error(400, `Unsupported language '${lang}'`);
  }
  const language = lang as LanguageCode;
  const textPage = clampStatsPage({
    limit: readInt(url, 'textLimit', STATS_DEFAULT_PAGE_SIZE),
    offset: readInt(url, 'textOffset', 0),
  });
  const collectionPage = clampStatsPage({
    limit: readInt(url, 'collectionLimit', textPage.limit),
    offset: readInt(url, 'collectionOffset', 0),
  });

  const [stats, texts, collections] = await Promise.all([
    getLanguageStats(locals.user.id, language),
    listTextStats(locals.user.id, language, textPage),
    listCollectionStats(locals.user.id, language, collectionPage),
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
    textsPage: {
      ...textPage,
      nextOffset: texts.length === textPage.limit ? textPage.offset + textPage.limit : null,
      prevOffset:
        textPage.offset > 0 ? Math.max(0, textPage.offset - textPage.limit) : null,
    },
    collections,
    collectionsPage: {
      ...collectionPage,
      nextOffset:
        collections.length === collectionPage.limit
          ? collectionPage.offset + collectionPage.limit
          : null,
      prevOffset:
        collectionPage.offset > 0
          ? Math.max(0, collectionPage.offset - collectionPage.limit)
          : null,
    },
  };
};
