/**
 * Curator phrase dictionary list (T-14.4a).
 *
 * Parallel to /moderation/dictionary (lemmas). Pulls phrases for
 * the active curator language with translation + chapter counts
 * so the curator can quickly find rows that need review or edit.
 *
 * Read-only here; the detail page at
 * /moderation/phrases/[id] handles editing.
 */
import { error } from '@sveltejs/kit';

import { listAdminPhrases } from '$lib/server/phrases.js';
import { LANGUAGES, isSupportedLanguage } from '@ciareader/shared-types';
import type { LanguageCode } from '@ciareader/shared-types';
import type { PageServerLoad } from './$types';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

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
      phrases: [],
      limit: DEFAULT_LIMIT,
      offset: 0,
      filters: { source: null, hidden: null, locked: null },
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

  const limit = Math.min(Math.max(readInt(url, 'limit', DEFAULT_LIMIT), 1), MAX_LIMIT);
  const offset = Math.max(readInt(url, 'offset', 0), 0);
  const sourceParam = url.searchParams.get('source');
  const source =
    sourceParam === 'user' ||
    sourceParam === 'curator' ||
    sourceParam === 'official_dictionary'
      ? sourceParam
      : undefined;
  const hiddenParam = url.searchParams.get('hidden');
  const hidden = hiddenParam === 'true' ? true : hiddenParam === 'false' ? false : undefined;
  const lockedParam = url.searchParams.get('locked');
  const locked = lockedParam === 'true' ? true : lockedParam === 'false' ? false : undefined;

  const phrases = await listAdminPhrases({
    language,
    source,
    hidden,
    locked,
    limit,
    offset,
  });

  return {
    language: {
      code: language,
      displayName: LANGUAGES[language].displayName,
      nativeName: LANGUAGES[language].nativeName,
    },
    descriptors,
    phrases,
    limit,
    offset,
    filters: {
      source: source ?? null,
      hidden: hidden === undefined ? null : hidden,
      locked: locked === undefined ? null : locked,
    },
  };
};
