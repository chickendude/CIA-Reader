// @vitest-environment node
/**
 * Tests for GET /api/v1/texts/:id/chapters/:idx/tokens (T-5.1a).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonContract } from '$lib/test/json-contract.js';

const getReadableText = vi.fn();
const loadChapterTokens = vi.fn();
const loadChapterPhraseSpans = vi.fn();
const resolveUser = vi.fn();

vi.mock('$lib/server/texts/upload.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/texts/upload.js')>(
    '$lib/server/texts/upload.js',
  );
  return {
    ...actual,
    getReadableText: (...a: unknown[]) => getReadableText(...a),
    getOwnedText: (...a: unknown[]) => getReadableText(...a),
  };
});

vi.mock('$lib/server/auth/require-user.js', () => ({
  resolveUser: (...a: unknown[]) => resolveUser(...a),
  requireUser: (...a: unknown[]) => resolveUser(...a),
}));

vi.mock('$lib/server/texts/tokens.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/texts/tokens.js')>(
    '$lib/server/texts/tokens.js',
  );
  return {
    ...actual,
    loadChapterTokens: (...a: unknown[]) => loadChapterTokens(...a),
  };
});

// T-14.3: phrase spans ride alongside tokens; mock the loader so
// existing tests stay focused on the lazy-token path. The default
// resolves to an empty array so the endpoint shape includes
// `phraseSpans: []` without each test having to stage it.
vi.mock('$lib/server/texts/phrase-spans.js', async () => {
  const actual = await vi.importActual<
    typeof import('$lib/server/texts/phrase-spans.js')
  >('$lib/server/texts/phrase-spans.js');
  return {
    ...actual,
    loadChapterPhraseSpans: (...a: unknown[]) => loadChapterPhraseSpans(...a),
  };
});

const VALID_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

type Get = (typeof import('./+server.js'))['GET'];

async function callGet(
  textId: string,
  idx: string,
  user: { id: string } | null = { id: 'user-1' },
) {
  const { GET } = await import('./+server.js');
  resolveUser.mockResolvedValue(user);
  const event = {
    params: { id: textId, idx },
  } as unknown as Parameters<Get>[0];
  try {
    return (await GET(event)) as Response;
  } catch (e) {
    return e as { status: number };
  }
}

function fixtureWithChapters(n: number) {
  return {
    text: { id: VALID_ID, ownerId: 'user-1', visibility: 'private' },
    chapters: Array.from({ length: n }, (_, i) => ({
      id: `c${i}`,
      idx: i,
      title: null,
      body: `body ${i}`,
      tokenCount: 0,
    })),
  };
}

beforeEach(() => {
  getReadableText.mockReset();
  resolveUser.mockReset();
  loadChapterTokens.mockReset();
  loadChapterTokens.mockResolvedValue(null);
  loadChapterPhraseSpans.mockReset();
  loadChapterPhraseSpans.mockResolvedValue([]);
});

afterEach(() => {
  vi.resetModules();
});

describe('GET /api/v1/texts/:id/chapters/:idx/tokens', () => {
  it('returns tokens for the requested chapter', async () => {
    getReadableText.mockResolvedValueOnce(fixtureWithChapters(3));
    loadChapterTokens.mockResolvedValueOnce([
      {
        id: 't0',
        idx: 0,
        surface: 'पाठ',
        isWord: true,
        isAmbiguous: false,
        isOov: false,
        lemmaId: 'lem-1',
        romanization: null,
        glossDefault: null,
        candidates: [],
        numberForms: null,
        status: 'unknown',
      },
    ]);
    const res = (await callGet(VALID_ID, '1')) as Response;
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      chapterId: string;
      chapterIdx: number;
      body: string;
      tokens: unknown[] | null;
    };
    expect(body.chapterIdx).toBe(1);
    expect(body.chapterId).toBe('c1');
    expect(body.body).toBe('body 1');
    expect(body.tokens).toHaveLength(1);
    expect(jsonContract(body)).toMatchInlineSnapshot(`
      {
        "body": "string",
        "chapterId": "string",
        "chapterIdx": "number",
        "pageHeight": "null",
        "pageImageUrl": "null",
        "pageWidth": "null",
        "phraseSpans": "array",
        "tokens": [
          {
            "candidates": "array",
            "glossDefault": "null",
            "id": "string",
            "idx": "number",
            "isAmbiguous": "boolean",
            "isOov": "boolean",
            "isWord": "boolean",
            "lemmaId": "string",
            "numberForms": "null",
            "romanization": "null",
            "status": "string",
            "surface": "string",
          },
        ],
      }
    `);
    expect(loadChapterTokens).toHaveBeenCalledWith('c1', 'user-1');
  });

  it('rejects an invalid uuid with 400', async () => {
    const r = (await callGet('not-a-uuid', '0')) as { status: number };
    expect(r.status).toBe(400);
    expect(getReadableText).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric chapter idx with 400', async () => {
    const r = (await callGet(VALID_ID, 'abc')) as { status: number };
    expect(r.status).toBe(400);
  });

  it('rejects a negative chapter idx with 400', async () => {
    const r = (await callGet(VALID_ID, '-1')) as { status: number };
    expect(r.status).toBe(400);
  });

  it('returns 404 for an unreadable text', async () => {
    getReadableText.mockResolvedValueOnce(null);
    const r = (await callGet(VALID_ID, '0')) as { status: number };
    expect(r.status).toBe(404);
  });

  it('returns 404 when the chapter idx is out of range', async () => {
    getReadableText.mockResolvedValueOnce(fixtureWithChapters(2));
    const r = (await callGet(VALID_ID, '99')) as { status: number };
    expect(r.status).toBe(404);
  });

  it('forwards anonymous viewers to the readability gate', async () => {
    getReadableText.mockResolvedValueOnce(fixtureWithChapters(1));
    await callGet(VALID_ID, '0', null);
    expect(getReadableText).toHaveBeenCalledWith(null, VALID_ID);
    expect(loadChapterTokens).toHaveBeenCalledWith('c0', null);
  });

  // Regression: the endpoint must authenticate via resolveUser (Bearer-aware),
  // not locals.user (cookie-only). Without it the Android reader — which sends
  // a Bearer token and no cookie — reads as anonymous and 404s on its own
  // private texts.
  it('authenticates the viewer via resolveUser so Bearer clients read private texts', async () => {
    getReadableText.mockResolvedValueOnce(fixtureWithChapters(1));
    loadChapterTokens.mockResolvedValueOnce([]);
    const res = (await callGet(VALID_ID, '0', { id: 'user-1' })) as Response;
    expect(res.status).toBe(200);
    expect(resolveUser).toHaveBeenCalled();
    expect(getReadableText).toHaveBeenCalledWith({ id: 'user-1' }, VALID_ID);
    expect(loadChapterTokens).toHaveBeenCalledWith('c0', 'user-1');
  });
});
