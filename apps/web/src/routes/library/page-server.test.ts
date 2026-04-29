// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listOwnedTexts = vi.fn();
const listSharedTexts = vi.fn();
const listOfficialTexts = vi.fn();

vi.mock('$lib/server/texts/library.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/texts/library.js')>(
    '$lib/server/texts/library.js',
  );
  return {
    ...actual,
    listOwnedTexts: (...a: unknown[]) => listOwnedTexts(...a),
    listSharedTexts: (...a: unknown[]) => listSharedTexts(...a),
    listOfficialTexts: (...a: unknown[]) => listOfficialTexts(...a),
  };
});

// T-10.2: loader now decorates each card with comprehension; mock
// the bulk helpers to "no data" so existing test fixtures don't
// have to mock the DB. Tests that care can override the resolved
// value.
vi.mock('$lib/server/learning-stats.js', () => ({
  estimatedComprehensionForTexts: async () => new Map(),
  estimatedComprehensionForCollections: async () => new Map(),
}));

// T-8.5: collections tab calls into collections.js; mock to empty.
vi.mock('$lib/server/collections.js', () => ({
  listCollectionsForUser: async () => [],
  listOfficialCollections: async () => [],
}));

type LoadFn = (typeof import('./+page.server.js'))['load'];
const USER = { id: 'user-1', role: 'user' as const };

async function callLoad(url: string, user: typeof USER | null = USER) {
  const { load } = await import('./+page.server.js');
  const event = {
    locals: { user },
    url: new URL(url),
  } as unknown as Parameters<LoadFn>[0];
  try {
    return await load(event);
  } catch (e) {
    return e as { status: number; location?: string };
  }
}

beforeEach(() => {
  listOwnedTexts.mockReset();
  listSharedTexts.mockReset();
  listOfficialTexts.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('/library loader', () => {
  it("defaults to the 'your' tab for an authenticated visitor", async () => {
    listOwnedTexts.mockResolvedValueOnce({
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
    expect(listOwnedTexts).toHaveBeenCalled();
  });

  it("defaults to the 'official' tab for an anonymous visitor", async () => {
    listOfficialTexts.mockResolvedValueOnce({
      cards: [],
      totalCount: 0,
      limit: 20,
      offset: 0,
    });
    const data = (await callLoad('http://x/library', null)) as { tab: string };
    expect(data.tab).toBe('official');
    expect(listOfficialTexts).toHaveBeenCalled();
  });

  it("redirects an anonymous visitor asking for the 'your' tab", async () => {
    const res = (await callLoad('http://x/library?tab=your', null)) as {
      status: number;
      location: string;
    };
    expect(res.status).toBe(303);
    expect(res.location).toContain('/login');
    expect(listOwnedTexts).not.toHaveBeenCalled();
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
    expect(listSharedTexts).toHaveBeenCalled();
  });

  it('forwards a language filter to the underlying service', async () => {
    listOwnedTexts.mockResolvedValueOnce({
      cards: [],
      totalCount: 0,
      limit: 20,
      offset: 0,
    });
    await callLoad('http://x/library?tab=your&language=mr');
    expect(listOwnedTexts).toHaveBeenCalledWith(
      { id: USER.id },
      expect.objectContaining({ language: 'mr' }),
    );
  });

  it('rejects an unsupported language with 400', async () => {
    const res = (await callLoad('http://x/library?language=xx')) as {
      status: number;
    };
    expect(res.status).toBe(400);
  });
});
