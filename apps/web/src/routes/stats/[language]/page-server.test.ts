// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getLanguageStats = vi.fn();
const listTextStats = vi.fn();
const listCollectionStats = vi.fn();

vi.mock('$lib/server/learning-stats.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/learning-stats.js')>(
    '$lib/server/learning-stats.js',
  );
  return {
    ...actual,
    getLanguageStats: (...a: unknown[]) => getLanguageStats(...a),
    listTextStats: (...a: unknown[]) => listTextStats(...a),
    listCollectionStats: (...a: unknown[]) => listCollectionStats(...a),
  };
});

type LoadFn = (typeof import('./+page.server.js'))['load'];
const USER = { id: 'user-1', role: 'user' as const };

async function callLoad(
  url: string,
  language = 'hi',
  user: typeof USER | null = USER,
) {
  const { load } = await import('./+page.server.js');
  const event = {
    params: { language },
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
  getLanguageStats.mockReset();
  listTextStats.mockReset();
  listCollectionStats.mockReset();
  getLanguageStats.mockResolvedValue({
    knownCount: 0,
    learningCount: 0,
    ignoredCount: 0,
    encounteredCount: 0,
    listeningMinutes: 0,
  });
  listTextStats.mockResolvedValue([]);
  listCollectionStats.mockResolvedValue([]);
});

describe('/stats/[language] loader', () => {
  it('passes capped pagination options to stats breakdown queries', async () => {
    listTextStats.mockResolvedValueOnce(Array.from({ length: 100 }, () => ({})));
    listCollectionStats.mockResolvedValueOnce(Array.from({ length: 100 }, () => ({})));

    const data = (await callLoad(
      'http://x/stats/hi?textLimit=500&textOffset=25&collectionOffset=10',
    )) as {
      textsPage: { limit: number; offset: number; nextOffset: number | null };
      collectionsPage: { limit: number; offset: number; nextOffset: number | null };
    };

    expect(listTextStats).toHaveBeenCalledWith(USER.id, 'hi', {
      limit: 100,
      offset: 25,
    });
    expect(listCollectionStats).toHaveBeenCalledWith(USER.id, 'hi', {
      limit: 100,
      offset: 10,
    });
    expect(data.textsPage.nextOffset).toBe(125);
    expect(data.collectionsPage.nextOffset).toBe(110);
  });

  it('redirects anonymous viewers before querying stats', async () => {
    const res = (await callLoad('http://x/stats/hi', 'hi', null)) as {
      status: number;
      location: string;
    };
    expect(res.status).toBe(303);
    expect(res.location).toContain('/login');
    expect(getLanguageStats).not.toHaveBeenCalled();
  });
});
