/**
 * Library page (T-4.5).
 *
 * Three tabs:
 *   - "your"     — texts the current user owns. Auth required.
 *   - "shared"   — texts shared with the current user (M7). Auth required.
 *   - "official" — public curated texts. No auth required, so the
 *     loader keeps that branch open to anonymous visitors. Used as
 *     marketing surface in T-7.6.
 *
 * The active tab comes from the URL: `?tab=your|shared|official`. We
 * default unauth visitors to 'official' so the public landing is the
 * curated library, not a "please log in" wall.
 */
import { error, redirect } from '@sveltejs/kit';

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  listOfficialTexts,
  listOwnedTexts,
  listSharedTexts,
  type ListPage,
} from '$lib/server/texts/library.js';
import { LANGUAGES, isSupportedLanguage } from '@ciareader/shared-types';
import type { LanguageCode } from '@ciareader/shared-types';
import type { PageServerLoad } from './$types';

type Tab = 'your' | 'shared' | 'official';

function readTab(raw: string | null, hasUser: boolean): Tab {
  if (raw === 'your' || raw === 'shared' || raw === 'official') return raw;
  return hasUser ? 'your' : 'official';
}

function readInt(url: URL, key: string, fallback: number): number {
  const raw = url.searchParams.get(key);
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const load: PageServerLoad = async ({ url, locals }) => {
  const tab = readTab(url.searchParams.get('tab'), Boolean(locals.user));

  // Auth gate: 'your' / 'shared' require a logged-in user. 'official'
  // is public.
  if ((tab === 'your' || tab === 'shared') && !locals.user) {
    throw redirect(
      303,
      `/login?next=${encodeURIComponent(url.pathname + url.search)}`,
    );
  }

  const langRaw = url.searchParams.get('language');
  const language: LanguageCode | null =
    langRaw && isSupportedLanguage(langRaw) ? (langRaw as LanguageCode) : null;
  if (langRaw && !language) {
    throw error(400, `Unsupported language '${langRaw}'`);
  }

  const limit = Math.min(
    Math.max(readInt(url, 'limit', DEFAULT_PAGE_SIZE), 1),
    MAX_PAGE_SIZE,
  );
  const offset = Math.max(readInt(url, 'offset', 0), 0);

  let page: ListPage;
  if (tab === 'your') {
    page = await listOwnedTexts(
      { id: locals.user!.id },
      { limit, offset, language: language ?? undefined },
    );
  } else if (tab === 'shared') {
    page = await listSharedTexts({ id: locals.user!.id }, { limit, offset });
  } else {
    page = await listOfficialTexts({
      limit,
      offset,
      language: language ?? undefined,
    });
  }

  return {
    tab,
    page,
    language,
    languages: Object.values(LANGUAGES).map((d) => ({
      code: d.code,
      displayName: d.displayName,
      nativeName: d.nativeName,
    })),
    isAuthenticated: Boolean(locals.user),
  };
};
