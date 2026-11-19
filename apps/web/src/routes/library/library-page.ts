import { redirect } from '@sveltejs/kit';

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  listOfficialBooks,
  catalogSort,
  listPersonalLibrary,
  listSharedTexts,
  type LibraryGridCard,
} from '$lib/server/texts/library.js';
import { listCollectionsForUser, listOfficialCollections } from '$lib/server/collections.js';
import { libraryBookStats, type BookWordStats } from '$lib/server/texts/book-stats.js';
import type { LanguageCode } from '@ciareader/shared-types';
import type { PageServerLoad } from './$types';

type Tab = 'your' | 'shared' | 'official' | 'collections';

function readTab(raw: string | null, hasUser: boolean): Tab {
  if (raw === 'your' || raw === 'shared' || raw === 'official' || raw === 'collections') {
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

export async function loadLibrary(
  { url, locals, parent }: Pick<Parameters<PageServerLoad>[0], 'url' | 'locals' | 'parent'>,
  allBooks = false,
) {
  const tab = allBooks ? 'your' : readTab(url.searchParams.get('tab'), Boolean(locals.user));

  // Auth gate: 'your' / 'shared' require a logged-in user. 'official'
  // is public.
  if ((tab === 'your' || tab === 'shared') && !locals.user) {
    throw redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }

  const { currentLanguage } = await parent();
  const language = (currentLanguage as LanguageCode | null) ?? null;

  const recent = tab === 'your' && !allBooks;
  if (recent && ['offset', 'limit', 'q'].some((key) => url.searchParams.has(key))) {
    const params = new URLSearchParams(url.search);
    params.delete('tab');
    redirect(303, `/library/all?${params}`);
  }
  const query = allBooks ? (url.searchParams.get('q') ?? '').trim() : '';
  const defaultLimit = tab === 'your' ? 10 : DEFAULT_PAGE_SIZE;
  const limit = Math.min(Math.max(readInt(url, 'limit', defaultLimit), 1), MAX_PAGE_SIZE);
  const offset = Math.max(readInt(url, 'offset', 0), 0);

  let page: { cards: LibraryGridCard[]; totalCount: number; limit: number; offset: number } = {
    cards: [],
    totalCount: 0,
    limit,
    offset,
  };
  type CollectionCard = {
    id: string;
    title: string;
    kind: string;
    language: string;
    visibility: string;
    coverUrl: string | null;
    textCount: number;
    canRename: boolean;
  };
  let collections: CollectionCard[] = [];
  const sort = catalogSort(url.searchParams.get('sort'), locals.user?.id);
  let collectionsPage = {
    totalCount: 0,
    limit,
    offset,
  };
  let stats: Record<string, BookWordStats | null> = {};

  if (tab === 'your') {
    page = await listPersonalLibrary(
      { id: locals.user!.id },
      { limit, offset, language: language ?? undefined, query },
    );
    if (allBooks && offset > 0 && offset >= page.totalCount) {
      const params = new URLSearchParams(url.search);
      const last = Math.max(0, Math.floor((page.totalCount - 1) / limit) * limit);
      if (last) params.set('offset', String(last));
      else params.delete('offset');
      redirect(303, params.size ? `/library/all?${params}` : '/library/all');
    }
  } else if (tab === 'shared') {
    page = await listSharedTexts({ id: locals.user!.id }, { limit, offset, language: language ?? undefined });
  } else if (tab === 'collections') {
    // T-8.5: collections tab. Signed-in users see their own + the
    // official catalog; anonymous see only the official catalog.
    const ownItems = locals.user ? await listCollectionsForUser(locals.user.id) : [];
    const officialItems = await listOfficialCollections(language ?? undefined);
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
    collections = paged.map((row) => ({
      id: row.collection.id,
      title: row.collection.title,
      kind: row.collection.kind,
      language: row.collection.language,
      visibility: row.collection.visibility,
      coverUrl: row.collection.coverUrl,
      textCount: row.textCount,
      canRename: locals.user?.role === 'admin' || Boolean(locals.user &&
        row.collection.ownerId === locals.user.id && row.collection.visibility !== 'official'),
    }));
  } else {
    const catalog = await listOfficialBooks({
      limit, offset, language: language ?? undefined, userId: locals.user?.id, sort,
    });
    page = catalog;
    stats = Object.fromEntries(catalog.cards.map(card => [card.id, card.stats]));
  }

  if (tab !== 'official') {
    const textIds = page.cards.filter(card => card.chapterCount == null).map(card => card.id);
    const collectionIds = [...page.cards.filter(card => card.chapterCount != null), ...collections].map(card => card.id);
    stats = await libraryBookStats(textIds, collectionIds, locals.user?.id);
  }

  return {
    allBooks,
    query,
    tab,
    page,
    stats,
    collections,
    sort,
    collectionsPage,
    language,
    isAuthenticated: Boolean(locals.user),
  };
}
