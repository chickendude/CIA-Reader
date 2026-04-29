/**
 * Public official library page (T-7.6).
 *
 * Distinct from /library?tab=official: this URL is public,
 * SEO-crawlable, and renders without the authed shell. Anyone can
 * browse the catalog of texts an admin has promoted to official
 * visibility, click through to read, and only hit a sign-in prompt
 * if they try to mark a word known.
 */
import { error } from '@sveltejs/kit';

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  listOfficialTexts,
} from '$lib/server/texts/library.js';
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

export const load: PageServerLoad = async ({ url }) => {
  const langRaw = url.searchParams.get('language');
  let language: LanguageCode | null = null;
  if (langRaw) {
    if (!isSupportedLanguage(langRaw)) {
      throw error(400, `Unsupported language '${langRaw}'`);
    }
    language = langRaw;
  }

  const limit = Math.min(
    Math.max(readInt(url, 'limit', DEFAULT_PAGE_SIZE), 1),
    MAX_PAGE_SIZE,
  );
  const offset = Math.max(readInt(url, 'offset', 0), 0);

  const page = await listOfficialTexts({
    limit,
    offset,
    language: language ?? undefined,
  });

  return {
    page,
    language,
    languages: Object.values(LANGUAGES).map((d) => ({
      code: d.code,
      displayName: d.displayName,
      nativeName: d.nativeName,
    })),
  };
};
