// @vitest-environment node
/**
 * Tests for the /dictionary/:language SSR page loader (T-3.6).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listDictionaryLemmas = vi.fn();

vi.mock('$lib/server/dictionary/browse.js', async () => {
  const actual = await vi.importActual<
    typeof import('$lib/server/dictionary/browse.js')
  >('$lib/server/dictionary/browse.js');
  return {
    ...actual,
    listDictionaryLemmas: (...a: unknown[]) => listDictionaryLemmas(...a),
  };
});

type LoadFn = (typeof import('./+page.server.js'))['load'];
type LoadEvent = Parameters<LoadFn>[0];

async function callLoad(
  url: string,
  params: Record<string, string | undefined> = { language: 'hi' },
) {
  const { load } = await import('./+page.server.js');
  const event = {
    params,
    url: new URL(url),
  } as unknown as LoadEvent;
  try {
    return await load(event);
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  listDictionaryLemmas.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('GET /dictionary/:language load', () => {
  it('returns language descriptor, lemmas, and query echo', async () => {
    listDictionaryLemmas.mockResolvedValueOnce({
      lemmas: [],
      totalCount: 0,
      limit: 50,
      offset: 0,
    });
    const data = (await callLoad(
      'http://x/dictionary/hi?q=%E0%A4%AC%E0%A5%8B%E0%A4%B2',
    )) as {
      language: { code: string; displayName: string };
      lemmas: unknown[];
      query: { q: string; pos: string[]; hasOfficialTranslation: boolean };
    };
    expect(data.language.code).toBe('hi');
    expect(data.language.displayName).toBe('Hindi');
    expect(data.query.q).toBe('बोल');
  });

  it('throws 404 on an unsupported language code', async () => {
    const res = (await callLoad('http://x/dictionary/bn', {
      language: 'bn',
    })) as { status: number };
    expect(res.status).toBe(404);
    expect(listDictionaryLemmas).not.toHaveBeenCalled();
  });

  it('silently clamps an out-of-range limit instead of 400', async () => {
    listDictionaryLemmas.mockResolvedValueOnce({
      lemmas: [],
      totalCount: 0,
      limit: 200,
      offset: 0,
    });
    const data = (await callLoad(
      'http://x/dictionary/hi?limit=9999',
    )) as { limit: number };
    expect(data.limit).toBe(200);
  });

  it('forwards has-official-translation=true to the service', async () => {
    listDictionaryLemmas.mockResolvedValueOnce({
      lemmas: [],
      totalCount: 0,
      limit: 50,
      offset: 0,
    });
    await callLoad('http://x/dictionary/hi?hasOfficialTranslation=true');
    expect(listDictionaryLemmas).toHaveBeenCalledWith(
      'hi',
      expect.objectContaining({ hasOfficialTranslation: true }),
    );
  });

  it('forwards pos filters (multiple values) to the service', async () => {
    listDictionaryLemmas.mockResolvedValueOnce({
      lemmas: [],
      totalCount: 0,
      limit: 50,
      offset: 0,
    });
    await callLoad('http://x/dictionary/hi?pos=verb&pos=noun');
    expect(listDictionaryLemmas).toHaveBeenCalledWith(
      'hi',
      expect.objectContaining({ pos: ['verb', 'noun'] }),
    );
  });
});
