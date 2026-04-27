/**
 * GET /api/v1/dictionary/:language/lemmas (T-3.6).
 *
 * Public, unauthenticated lemma browse + search. Mirrors what the
 * SSR page at `/dictionary/:language` renders, so the two surfaces
 * stay in sync.
 */
import { error, json } from '@sveltejs/kit';

import {
  DEFAULT_PAGE_SIZE,
  listDictionaryLemmas,
  MAX_PAGE_SIZE,
  publicLemma,
} from '$lib/server/dictionary/browse.js';
import { isSupportedLanguage, type LanguageCode } from '@ciareader/shared-types';
import type { RequestHandler } from './$types';

function readInt(
  url: URL,
  key: string,
  fallback: number | null = null,
): number | null {
  const raw = url.searchParams.get(key);
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    throw error(400, `${key} must be an integer`);
  }
  return n;
}

export const GET: RequestHandler = async ({ params, url }) => {
  const rawLang = params.language ?? '';
  if (!isSupportedLanguage(rawLang)) {
    throw error(400, `Unsupported language: ${rawLang}`);
  }
  const language = rawLang as LanguageCode;

  const limit = readInt(url, 'limit', DEFAULT_PAGE_SIZE) ?? DEFAULT_PAGE_SIZE;
  const offset = readInt(url, 'offset', 0) ?? 0;
  if (limit < 1 || limit > MAX_PAGE_SIZE) {
    throw error(400, `limit must be between 1 and ${MAX_PAGE_SIZE}`);
  }
  if (offset < 0) throw error(400, 'offset must be non-negative');

  const result = await listDictionaryLemmas(language, {
    q: url.searchParams.get('q'),
    pos: url.searchParams.getAll('pos'),
    minRank: readInt(url, 'minRank'),
    maxRank: readInt(url, 'maxRank'),
    hasOfficialTranslation: url.searchParams.get('hasOfficialTranslation') === 'true',
    limit,
    offset,
  });

  return json({
    language,
    lemmas: result.lemmas.map(publicLemma),
    totalCount: result.totalCount,
    limit: result.limit,
    offset: result.offset,
  });
};
