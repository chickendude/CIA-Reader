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
import {
  listCollectionsForUser,
  listOfficialCollections,
} from '$lib/server/collections.js';
import {
  estimatedComprehensionForCollections,
  estimatedComprehensionForTexts,
} from '$lib/server/learning-stats.js';
import { LANGUAGES, isSupportedLanguage } from '@ciareader/shared-types';
import type { LanguageCode } from '@ciareader/shared-types';
import type { PageServerLoad } from './$types';

type Tab = 'your' | 'shared' | 'official' | 'collections';

function readTab(raw: string | null, hasUser: boolean): Tab {
  if (
    raw === 'your' ||
    raw === 'shared' ||
    raw === 'official' ||
    raw === 'collections'
  ) {
    return raw;
  }
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

  let page: ListPage = {
    cards: [],
    totalCount: 0,
    limit,
    offset,
  };
  let collections: Array<{
    id: string;
    title: string;
    kind: string;
    language: string;
    visibility: string;
    coverUrl: string | null;
    textCount: number;
    estimatedComprehensionPct: number | null;
  }> = [];
  let collectionsPage = {
    totalCount: 0,
    limit,
    offset,
  };
  // T-10.2: per-card known% badge. Decorated after the page is
  // fetched so we don't push a JOIN into every list query — the
  // batch helper does one round trip regardless of card count.
  let textComprehension = new Map<string, number | null>();

  if (tab === 'your') {
    page = await listOwnedTexts(
      { id: locals.user!.id },
      { limit, offset, language: language ?? undefined },
    );
  } else if (tab === 'shared') {
    page = await listSharedTexts({ id: locals.user!.id }, { limit, offset });
  } else if (tab === 'collections') {
    // T-8.5: collections tab. Signed-in users see their own + the
    // official catalog; anonymous see only the official catalog.
    const ownItems = locals.user
      ? await listCollectionsForUser(locals.user.id)
      : [];
    const officialItems = await listOfficialCollections(
      language ?? undefined,
    );
    // Merge by id so a collection that's both owned and official
    // doesn't appear twice. Owner-side row wins because it carries
    // the most-current edit state.
    const seen = new Set<string>();
    const merged = [...ownItems, ...officialItems].filter((row) => {
      if (language && row.collection.language !== language) return false;
      if (seen.has(row.collection.id)) return false;
      seen.add(row.collection.id);
      return true;
    });
    const paged = merged.slice(offset, offset + limit);
    collectionsPage = {
      totalCount: merged.length,
      limit,
      offset,
    };
    // T-10.2 collection-card badge: bulk-fetch comprehension for
    // every visible collection. Anonymous viewers can't have
    // any known lemmas yet, so we skip the lookup for them.
    const compMap = locals.user
      ? await estimatedComprehensionForCollections(
          locals.user.id,
          paged.map((m) => m.collection.id),
        )
      : new Map<string, number | null>();
    collections = paged.map((row) => ({
      id: row.collection.id,
      title: row.collection.title,
      kind: row.collection.kind,
      language: row.collection.language,
      visibility: row.collection.visibility,
      coverUrl: row.collection.coverUrl,
      textCount: row.textCount,
      estimatedComprehensionPct: compMap.get(row.collection.id) ?? null,
    }));
  } else {
    page = await listOfficialTexts({
      limit,
      offset,
      language: language ?? undefined,
    });
  }

  // T-10.2 text-card badge — same flow for the your / shared /
  // official tabs. We only call when the viewer is signed in;
  // anonymous browsers of the official catalog see no badge.
  if (locals.user && page.cards.length > 0) {
    textComprehension = await estimatedComprehensionForTexts(
      locals.user.id,
      page.cards.map((c) => c.id),
    );
  }

  return {
    tab,
    page,
    textComprehension: Object.fromEntries(textComprehension),
    collections,
    collectionsPage,
    language,
    languages: Object.values(LANGUAGES).map((d) => ({
      code: d.code,
      displayName: d.displayName,
      nativeName: d.nativeName,
    })),
    isAuthenticated: Boolean(locals.user),
  };
};
