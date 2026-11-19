// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listPersonalLibrary = vi.fn();
const listSharedTexts = vi.fn();
const listOfficialBooks = vi.fn();
const listCollectionsForUser = vi.fn();
const listOfficialCollections = vi.fn();
const libraryBookStats = vi.fn();

vi.mock('$lib/server/texts/library.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/texts/library.js')>(
    '$lib/server/texts/library.js',
  );
  return {
    ...actual,
    listPersonalLibrary: (...a: unknown[]) => listPersonalLibrary(...a),
    listSharedTexts: (...a: unknown[]) => listSharedTexts(...a),
    listOfficialBooks: (...a: unknown[]) => listOfficialBooks(...a),
  };
});

vi.mock('$lib/server/texts/book-stats.js', () => ({
  libraryBookStats: (...args: unknown[]) => libraryBookStats(...args),
}));

// T-8.5: collections tab calls into collections.js; mock to empty.
vi.mock('$lib/server/collections.js', () => ({
  listCollectionsForUser: (...a: unknown[]) => listCollectionsForUser(...a),
  listOfficialCollections: (...a: unknown[]) => listOfficialCollections(...a),
}));

const USER = { id: 'user-1', role: 'user' as const };

async function callLoad(
  url: string,
  user: typeof USER | null = USER,
  currentLanguage: string | null = 'hi',
) {
  const event = {
    locals: { user },
    url: new URL(url),
    // #436: the library scopes to the layout's resolved current language.
    parent: async () => ({ currentLanguage }),
  };
  try {
    if (event.url.pathname === '/library/all') {
      const { load } = await import('./all/+page.server.js');
      return await load(event as unknown as Parameters<typeof load>[0]);
    }
    const { load } = await import('./+page.server.js');
    return await load(event as unknown as Parameters<typeof load>[0]);
  } catch (e) {
    return e as { status: number; location?: string };
  }
}

beforeEach(() => {
  listPersonalLibrary.mockReset();
  listSharedTexts.mockReset();
  listOfficialBooks.mockReset();
  listCollectionsForUser.mockReset();
  listOfficialCollections.mockReset();
  libraryBookStats.mockReset();
  listCollectionsForUser.mockResolvedValue([]);
  listOfficialCollections.mockResolvedValue([]);
  libraryBookStats.mockResolvedValue({});
});

afterEach(() => {
  vi.resetModules();
});

describe('/library loader', () => {
  it("defaults to the 'your' tab for an authenticated visitor", async () => {
    listPersonalLibrary.mockResolvedValueOnce({
      cards: [{ id: 't1', title: 'Sample', language: 'hi' }],
      totalCount: 1,
      limit: 20,
      offset: 0,
    });
    const data = (await callLoad('http://x/library')) as {
      tab: string;
      page: { totalCount: number };
    };
    expect(data.tab).toBe('your');
    expect(data.page.totalCount).toBe(1);
    expect(listPersonalLibrary).toHaveBeenCalledWith(
      { id: USER.id }, expect.objectContaining({ limit: 10, offset: 0 }),
    );
  });

  it('searches all personal books in the current language before pagination', async () => {
    listPersonalLibrary.mockResolvedValueOnce({ cards: [], totalCount: 24, limit: 10, offset: 10 });
    await callLoad('http://x/library/all?q=Test+Book&offset=10');
    expect(listPersonalLibrary).toHaveBeenCalledWith(
      { id: USER.id }, { query: 'Test Book', language: 'hi', limit: 10, offset: 10 },
    );
  });

  it('returns to the last available page after its final book is removed', async () => {
    listPersonalLibrary.mockResolvedValueOnce({ cards: [], totalCount: 10, limit: 10, offset: 10 });
    expect(await callLoad('http://x/library/all?q=book&offset=10'))
      .toMatchObject({ status: 303, location: '/library/all?q=book' });
  });

  it("defaults to the 'official' tab for an anonymous visitor", async () => {
    listOfficialBooks.mockResolvedValueOnce({
      cards: [],
      totalCount: 0,
      limit: 20,
      offset: 0,
    });
    const data = (await callLoad('http://x/library', null)) as { tab: string };
    expect(data.tab).toBe('official');
    expect(listOfficialBooks).toHaveBeenCalled();
  });

  it('counts official chapter books and standalone texts in the same page', async () => {
    listOfficialBooks.mockResolvedValueOnce({ cards: [
      { id: 'book', chapterCount: 2, stats: { words: 250, uniqueWords: 20, unresolved: 4, knownPct: 80, uniquePct: 40 } },
      { id: 'text', stats: { words: 100, uniqueWords: 10, unresolved: 0, knownPct: 50, uniquePct: 30 } },
    ], totalCount: 4, offset: 0, limit: 2 });
    expect(await callLoad('http://x/library?tab=official&limit=2&sort=unique')).toMatchObject({
      stats: { book: { knownPct: 80, uniquePct: 40 }, text: { knownPct: 50, uniquePct: 30 } },
      page: { cards: [{ id: 'book' }, { id: 'text' }], totalCount: 4 },
    });
    expect(listOfficialBooks).toHaveBeenCalledWith({
      userId: USER.id, language: 'hi', sort: 'unique', limit: 2, offset: 0,
    });
  });

  it("redirects an anonymous visitor asking for the 'your' tab", async () => {
    const res = (await callLoad('http://x/library?tab=your', null)) as {
      status: number;
      location: string;
    };
    expect(res.status).toBe(303);
    expect(res.location).toContain('/login');
    expect(listPersonalLibrary).not.toHaveBeenCalled();
  });

  it("routes 'shared' through listSharedTexts", async () => {
    listSharedTexts.mockResolvedValueOnce({
      cards: [],
      totalCount: 0,
      limit: 20,
      offset: 0,
    });
    const data = (await callLoad('http://x/library?tab=shared')) as {
      tab: string;
    };
    expect(data.tab).toBe('shared');
    expect(listSharedTexts).toHaveBeenCalledWith(
      { id: USER.id }, expect.objectContaining({ language: 'hi' }),
    );
  });

  it('scopes the listing to the current language (#436)', async () => {
    listPersonalLibrary.mockResolvedValueOnce({
      cards: [],
      totalCount: 0,
      limit: 20,
      offset: 0,
    });
    await callLoad('http://x/library?tab=your', USER, 'mr');
    expect(listPersonalLibrary).toHaveBeenCalledWith(
      { id: USER.id },
      expect.objectContaining({ language: 'mr' }),
    );
  });

  it('echoes the current language back to the page (#436)', async () => {
    listPersonalLibrary.mockResolvedValueOnce({
      cards: [],
      totalCount: 0,
      limit: 20,
      offset: 0,
    });
    const data = (await callLoad('http://x/library?tab=your', USER, 'or')) as {
      language: string;
    };
    expect(data.language).toBe('or');
  });

  it('paginates collection cards before fetching comprehension (T-12.5)', async () => {
    const collectionRows = Array.from({ length: 5 }, (_, i) => ({
      collection: {
        id: `c${i}`,
        title: `Collection ${i}`,
        kind: 'chapter_book',
        language: 'hi',
        visibility: 'private',
        coverUrl: null,
      },
      textCount: i + 1,
    }));
    listCollectionsForUser.mockResolvedValueOnce(collectionRows);
    const data = (await callLoad(
      'http://x/library?tab=collections&limit=2&offset=2',
    )) as {
      collections: Array<{ id: string }>;
      collectionsPage: { totalCount: number; limit: number; offset: number };
    };

    expect(data.collections.map((c) => c.id)).toEqual(['c2', 'c3']);
    expect(data.collectionsPage).toEqual({
      totalCount: 5,
      limit: 2,
      offset: 2,
    });
    expect(libraryBookStats).toHaveBeenCalledWith([], ['c2', 'c3'], USER.id);
  });
});
