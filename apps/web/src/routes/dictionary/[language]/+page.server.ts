/**
 * Public dictionary browse page loader (T-3.6).
 *
 * Renders server-side — no auth required — so each language's lemma
 * index is crawlable. Search, filters, and pagination are driven by
 * URL query params so deep links and back-button work without JS.
 */
import { error } from '@sveltejs/kit';

import {
  DEFAULT_PAGE_SIZE,
  listDictionaryLemmas,
  MAX_PAGE_SIZE,
  publicLemma,
} from '$lib/server/dictionary/browse.js';
import {
  getLanguage,
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

export const load: PageServerLoad = async ({ params, url }) => {
  if (!isSupportedLanguage(params.language)) {
    throw error(404, `Unknown language: ${params.language}`);
  }
  const language = params.language as LanguageCode;
  const descriptor = getLanguage(language);

  const limit = Math.min(
    Math.max(readInt(url, 'limit', DEFAULT_PAGE_SIZE), 1),
    MAX_PAGE_SIZE,
  );
  const offset = Math.max(readInt(url, 'offset', 0), 0);
  const q = url.searchParams.get('q');
  const pos = url.searchParams.getAll('pos');
  const hasOfficial = url.searchParams.get('hasOfficialTranslation') === 'true';

  const result = await listDictionaryLemmas(language, {
    q,
    pos,
    hasOfficialTranslation: hasOfficial,
    limit,
    offset,
  });

  return {
    language: descriptor,
    lemmas: result.lemmas.map(publicLemma),
    totalCount: result.totalCount,
    limit: result.limit,
    offset: result.offset,
    // #318: Surface the nukta-agnostic fallback so the page can
    // render a hint when an exact-match search missed and we showed
    // the user the closest nukta-stripped match instead.
    usedNuktaFallback: result.usedNuktaFallback,
    query: {
      q: q ?? '',
      pos,
      hasOfficialTranslation: hasOfficial,
    },
  };
};
