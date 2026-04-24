// @vitest-environment node
/**
 * Tests for /moderation/dictionary SSR loader (T-3.7).
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
  grantedLanguages: string[] = ['hi', 'mr'],
) {
  const { load } = await import('./+page.server.js');
  const parent = vi.fn().mockResolvedValue({
    moderator: {
      id: 'u1',
      role: 'curator',
      grantedLanguages,
    },
  });
  const event = {
    url: new URL(url),
    parent,
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

describe('/moderation/dictionary loader', () => {
  it('defaults to the first granted language when none is in the URL', async () => {
    listDictionaryLemmas.mockResolvedValueOnce({
      lemmas: [],
      totalCount: 0,
      limit: 50,
      offset: 0,
    });
    const data = (await callLoad('http://x/moderation/dictionary')) as {
      language: { code: string };
    };
    expect(data.language.code).toBe('hi');
    expect(listDictionaryLemmas).toHaveBeenCalledWith('hi', expect.any(Object));
  });

  it('honors the ?language= query when the curator has that grant', async () => {
    listDictionaryLemmas.mockResolvedValueOnce({
      lemmas: [],
      totalCount: 0,
      limit: 50,
      offset: 0,
    });
    const data = (await callLoad(
      'http://x/moderation/dictionary?language=mr',
    )) as { language: { code: string } };
    expect(data.language.code).toBe('mr');
  });

  it('403s when the requested language is outside the curator’s grants', async () => {
    const res = (await callLoad(
      'http://x/moderation/dictionary?language=or',
      ['hi'],
    )) as { status: number };
    expect(res.status).toBe(403);
    expect(listDictionaryLemmas).not.toHaveBeenCalled();
  });

  it('returns an empty shape when the curator has no grants', async () => {
    const data = (await callLoad('http://x/moderation/dictionary', [])) as {
      language: null;
      descriptors: unknown[];
    };
    expect(data.language).toBeNull();
    expect(data.descriptors).toEqual([]);
    expect(listDictionaryLemmas).not.toHaveBeenCalled();
  });
});
