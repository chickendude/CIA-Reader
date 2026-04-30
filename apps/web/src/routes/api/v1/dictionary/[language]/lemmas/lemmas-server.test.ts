// @vitest-environment node
/**
 * Route tests for GET /api/v1/dictionary/:language/lemmas (T-3.6).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonContract } from '$lib/test/json-contract.js';

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

type GetFn = (typeof import('./+server.js'))['GET'];
type GetEvent = Parameters<GetFn>[0];

async function callGet(
  url: string,
  params: Record<string, string | undefined> = { language: 'hi' },
) {
  const { GET } = await import('./+server.js');
  const event = {
    params,
    url: new URL(url),
    request: new Request(url),
  } as unknown as GetEvent;
  try {
    return await GET(event);
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

describe('GET /api/v1/dictionary/:language/lemmas', () => {
  it('returns a JSON page of lemmas with a total count', async () => {
    listDictionaryLemmas.mockResolvedValueOnce({
      lemmas: [
        {
          id: 'lemma-1',
          language: 'hi',
          headword: 'बोलना',
          pos: 'verb',
          script: 'Deva',
          glossDefault: 'to speak',
          frequencyRank: 42,
          source: 'official_dictionary',
          sourceAttribution: 'Hindi WordNet',
          sourceId: 'hwn:12345',
          curatorLocked: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      totalCount: 1,
      limit: 50,
      offset: 0,
      usedNuktaFallback: false,
    });
    const res = (await callGet(
      'http://x/api/v1/dictionary/hi/lemmas?q=%E0%A4%AC%E0%A5%8B%E0%A4%B2',
    )) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.language).toBe('hi');
    expect(json.lemmas[0]).toMatchObject({
      headword: 'बोलना',
      provenanceSource: 'official_dictionary',
    });
    expect(json.lemmas[0].sourceId).toBeUndefined();
    expect(json.totalCount).toBe(1);
    expect(jsonContract(json)).toMatchInlineSnapshot(`
      {
        "language": "string",
        "lemmas": [
          {
            "curatorLocked": "boolean",
            "frequencyRank": "number",
            "glossDefault": "string",
            "headword": "string",
            "id": "string",
            "language": "string",
            "pos": "string",
            "provenanceSource": "string",
            "script": "string",
            "sourceAttribution": "string",
          },
        ],
        "limit": "number",
        "offset": "number",
        "totalCount": "number",
        "usedNuktaFallback": "boolean",
      }
    `);
  });

  it('returns 400 on an unsupported language', async () => {
    const res = (await callGet('http://x/api/v1/dictionary/bn/lemmas', {
      language: 'bn',
    })) as { status: number };
    expect(res.status).toBe(400);
    expect(listDictionaryLemmas).not.toHaveBeenCalled();
  });

  it('returns 400 on a non-numeric limit', async () => {
    const res = (await callGet(
      'http://x/api/v1/dictionary/hi/lemmas?limit=abc',
    )) as { status: number };
    expect(res.status).toBe(400);
    expect(listDictionaryLemmas).not.toHaveBeenCalled();
  });

  it('returns 400 when limit exceeds the cap', async () => {
    const res = (await callGet(
      'http://x/api/v1/dictionary/hi/lemmas?limit=9999',
    )) as { status: number };
    expect(res.status).toBe(400);
  });

  it('returns 400 on a negative offset', async () => {
    const res = (await callGet(
      'http://x/api/v1/dictionary/hi/lemmas?offset=-5',
    )) as { status: number };
    expect(res.status).toBe(400);
  });

  it('forwards filters to the service', async () => {
    listDictionaryLemmas.mockResolvedValueOnce({
      lemmas: [],
      totalCount: 0,
      limit: 10,
      offset: 20,
      usedNuktaFallback: false,
    });
    await callGet(
      'http://x/api/v1/dictionary/hi/lemmas?pos=verb&pos=noun&minRank=1&maxRank=1000&hasOfficialTranslation=true&limit=10&offset=20',
    );
    expect(listDictionaryLemmas).toHaveBeenCalledWith(
      'hi',
      expect.objectContaining({
        pos: ['verb', 'noun'],
        minRank: 1,
        maxRank: 1000,
        hasOfficialTranslation: true,
        limit: 10,
        offset: 20,
      }),
    );
  });
});
