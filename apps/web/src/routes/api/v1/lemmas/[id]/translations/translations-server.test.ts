// @vitest-environment node
/**
 * Route tests for GET /api/v1/lemmas/:id/translations (T-3.3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonContract } from '$lib/test/json-contract.js';

const getLemmaTranslations = vi.fn();
const resolveUser = vi.fn();

vi.mock('$lib/server/dictionary/lookups.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/dictionary/lookups.js')>(
    '$lib/server/dictionary/lookups.js',
  );
  return {
    ...actual,
    getLemmaTranslations: (...a: unknown[]) => getLemmaTranslations(...a),
  };
});

vi.mock('$lib/server/auth/require-user.js', () => ({
  resolveUser: () => resolveUser(),
}));

type GetFn = (typeof import('./+server.js'))['GET'];
type GetEvent = Parameters<GetFn>[0];

const VALID_LEMMA_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

async function callGet(id: string, user: { id: string; role: string } | null = null) {
  resolveUser.mockResolvedValueOnce(user);
  const { GET } = await import('./+server.js');
  const event = {
    params: { id },
    request: new Request(`http://x/api/v1/lemmas/${id}/translations`),
  } as unknown as GetEvent;
  try {
    return await GET(event);
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  getLemmaTranslations.mockReset();
  resolveUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('GET /api/v1/lemmas/:id/translations', () => {
  it('returns 400 on a malformed lemma id without touching the service', async () => {
    const res = (await callGet('nope')) as { status: number };
    expect(res.status).toBe(400);
    expect(getLemmaTranslations).not.toHaveBeenCalled();
  });

  it('returns 200 with the bucketed shape for an anonymous viewer', async () => {
    getLemmaTranslations.mockResolvedValueOnce({
      lemma: {
        id: VALID_LEMMA_ID,
        language: 'hi',
        headword: 'पानी',
        pos: 'NOUN',
        script: 'Deva',
        glossDefault: 'water',
        frequencyRank: 120,
      },
      translations: {
        personal: [],
        official: [
          {
            id: 'tr-1',
            source: 'official_dictionary',
            submittedBy: null,
            parentTranslationId: null,
            body: 'water',
            targetLanguage: 'en',
            sourceAttribution: 'Hindi WordNet',
            provenance: { kind: 'imported', attribution: 'Hindi WordNet' },
            hidden: false,
            voteScore: 2,
            viewerVote: null,
            createdAt: new Date('2026-04-27T00:00:00Z'),
            updatedAt: new Date('2026-04-27T00:00:00Z'),
          },
        ],
        community: [],
      },
    });
    const res = (await callGet(VALID_LEMMA_ID)) as Response;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lemma.headword).toBe('पानी');
    expect(body.translations.official[0].body).toBe('water');
    expect(jsonContract(body)).toMatchInlineSnapshot(`
      {
        "lemma": {
          "frequencyRank": "number",
          "glossDefault": "string",
          "headword": "string",
          "id": "string",
          "language": "string",
          "pos": "string",
          "script": "string",
        },
        "translations": {
          "community": "array",
          "official": [
            {
              "body": "string",
              "createdAt": "string",
              "hidden": "boolean",
              "id": "string",
              "parentTranslationId": "null",
              "provenance": {
                "attribution": "string",
                "kind": "string",
              },
              "source": "string",
              "sourceAttribution": "string",
              "submittedBy": "null",
              "targetLanguage": "string",
              "updatedAt": "string",
              "viewerVote": "null",
              "voteScore": "number",
            },
          ],
          "personal": "array",
        },
      }
    `);
    expect(getLemmaTranslations).toHaveBeenCalledWith(VALID_LEMMA_ID, null);
  });

  it('threads the authenticated viewer down to the service for personal-bucket resolution', async () => {
    getLemmaTranslations.mockResolvedValueOnce({
      lemma: {
        id: VALID_LEMMA_ID,
        language: 'hi',
        headword: 'x',
        pos: 'NOUN',
        script: 'Deva',
        glossDefault: null,
        frequencyRank: null,
      },
      translations: { personal: [], official: [], community: [] },
    });
    await callGet(VALID_LEMMA_ID, { id: 'u1', role: 'user' });
    expect(getLemmaTranslations).toHaveBeenCalledWith(VALID_LEMMA_ID, {
      id: 'u1',
      role: 'user',
    });
  });

  it('returns 404 when the lemma does not exist', async () => {
    const { LemmaNotFoundError } = await import('$lib/server/dictionary/lookups.js');
    getLemmaTranslations.mockRejectedValueOnce(new LemmaNotFoundError(VALID_LEMMA_ID));
    const res = (await callGet(VALID_LEMMA_ID)) as { status: number };
    expect(res.status).toBe(404);
  });

  it('propagates unexpected service errors instead of swallowing them', async () => {
    getLemmaTranslations.mockRejectedValueOnce(new Error('boom'));
    const result = (await callGet(VALID_LEMMA_ID)) as unknown as Error;
    expect(result.message).toBe('boom');
  });
});
