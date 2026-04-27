/**
 * Curator dictionary list (T-3.7).
 *
 * Reuses the public browse service so curators see the same index the
 * public does — filtered to the languages the current curator is granted
 * on. Admins see every MVP language.
 *
 * The curator-only affordances (merge, split, edit) live on the detail
 * page at /moderation/dictionary/[id]. This page is the jumping-off
 * point.
 */
import { error } from '@sveltejs/kit';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  listDictionaryLemmas,
  publicLemma,
} from '$lib/server/dictionary/browse.js';
import { LANGUAGES, isSupportedLanguage } from '@ciareader/shared-types';
import type { LanguageCode } from '@ciareader/shared-types';
import type { PageServerLoad } from './$types';

function readInt(url: URL, key: string, fallback: number): number {
  const raw = url.searchParams.get(key);
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const load: PageServerLoad = async ({ url, parent }) => {
  const { moderator } = await parent();
  if (moderator.grantedLanguages.length === 0) {
    return {
      language: null,
      descriptors: [],
      lemmas: [],
      totalCount: 0,
      limit: DEFAULT_PAGE_SIZE,
      offset: 0,
      query: { q: '' },
      isAdmin: moderator.role === 'admin',
    };
  }

  const descriptors = moderator.grantedLanguages.map((code) => ({
    code,
    displayName: LANGUAGES[code].displayName,
    nativeName: LANGUAGES[code].nativeName,
  }));

  const requestedLang = url.searchParams.get('language');
  const fallback = moderator.grantedLanguages[0]!;
  const language: LanguageCode =
    requestedLang && isSupportedLanguage(requestedLang)
      ? (requestedLang as LanguageCode)
      : fallback;

  if (!moderator.grantedLanguages.includes(language)) {
    throw error(403, `You do not have curator rights for ${language}`);
  }

  const limit = Math.min(
    Math.max(readInt(url, 'limit', DEFAULT_PAGE_SIZE), 1),
    MAX_PAGE_SIZE,
  );
  const offset = Math.max(readInt(url, 'offset', 0), 0);
  const q = url.searchParams.get('q');

  const result = await listDictionaryLemmas(language, { q, limit, offset });

  return {
    language: {
      code: language,
      displayName: LANGUAGES[language].displayName,
      nativeName: LANGUAGES[language].nativeName,
      textDirection: LANGUAGES[language].textDirection,
    },
    descriptors,
    lemmas: result.lemmas.map(publicLemma),
    totalCount: result.totalCount,
    limit: result.limit,
    offset: result.offset,
    query: { q: q ?? '' },
    isAdmin: moderator.role === 'admin',
  };
};
