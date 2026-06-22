// @vitest-environment node
/**
 * Route tests for POST /api/v1/texts (T-4.1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonContract } from '$lib/test/json-contract.js';

const createPastedText = vi.fn();
const createTxtText = vi.fn();
const requireUser = vi.fn();
const consumeRateLimit = vi.fn();

vi.mock('$lib/server/texts/upload.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/texts/upload.js')>(
    '$lib/server/texts/upload.js',
  );
  return {
    ...actual,
    createPastedText: (...a: unknown[]) => createPastedText(...a),
    createTxtText: (...a: unknown[]) => createTxtText(...a),
  };
});

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
  requireVerifiedUser: (...a: unknown[]) => requireUser(...a),
}));

vi.mock('$lib/server/auth/rate-limits.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/auth/rate-limits.js')>(
    '$lib/server/auth/rate-limits.js',
  );
  return {
    ...actual,
    consumeRateLimit: (...a: unknown[]) => consumeRateLimit(...a),
  };
});

const listOwnedTexts = vi.fn();
const listSharedTexts = vi.fn();
const listOfficialTexts = vi.fn();

vi.mock('$lib/server/texts/library.js', () => ({
  listOwnedTexts: (...a: unknown[]) => listOwnedTexts(...a),
  listSharedTexts: (...a: unknown[]) => listSharedTexts(...a),
  listOfficialTexts: (...a: unknown[]) => listOfficialTexts(...a),
}));

type PostFn = (typeof import('./+server.js'))['POST'];
type GetFn = (typeof import('./+server.js'))['GET'];

const USER = { id: 'user-1', role: 'user' as const };

async function callPost(body: unknown, user: typeof USER | null = USER) {
  if (user) {
    requireUser.mockResolvedValueOnce(user);
  } else {
    // Simulate the require-user 401 path.
    requireUser.mockImplementationOnce(() => {
      throw { status: 401, body: { message: 'Unauthorized' } };
    });
  }
  const { POST } = await import('./+server.js');
  const event = {
    params: {},
    request: new Request('http://x/api/v1/texts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as Parameters<PostFn>[0];
  try {
    return await POST(event);
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  createPastedText.mockReset();
  createTxtText.mockReset();
  requireUser.mockReset();
  consumeRateLimit.mockReset();
  listOwnedTexts.mockReset();
  listSharedTexts.mockReset();
  listOfficialTexts.mockReset();
  consumeRateLimit.mockResolvedValue({
    limit: 50,
    remaining: 49,
    subjectType: 'user',
  });
});

afterEach(() => {
  vi.resetModules();
});

describe('POST /api/v1/texts', () => {
  it('returns 201 with the new text on the paste path', async () => {
    createPastedText.mockResolvedValueOnce({
      text: {
        id: 'text-1',
        ownerId: USER.id,
        language: 'hi',
        title: 'My text',
        sourceType: 'paste',
        status: 'pending',
        visibility: 'private',
        createdAt: new Date('2026-04-27T00:00:00Z'),
      },
      chapter: { id: 'chap-1' },
      chapters: [{ id: 'chap-1' }],
    });
    const res = (await callPost({
      language: 'hi',
      title: 'My text',
      body: 'पाठ का मूल पाठ।',
    })) as Response;
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.text).toMatchObject({
      id: 'text-1',
      status: 'pending',
      visibility: 'private',
      sourceType: 'paste',
    });
    expect(jsonContract(json)).toMatchInlineSnapshot(`
      {
        "chapterCount": "number",
        "text": {
          "createdAt": "string",
          "id": "string",
          "language": "string",
          "ownerId": "string",
          "sourceType": "string",
          "status": "string",
          "title": "string",
          "visibility": "string",
        },
      }
    `);
    expect(json.chapterCount).toBe(1);
    expect(createPastedText).toHaveBeenCalledWith(
      { id: USER.id },
      { language: 'hi', title: 'My text', body: 'पाठ का मूल पाठ।' },
    );
    expect(createTxtText).not.toHaveBeenCalled();
  });

  it('routes sourceType=txt through createTxtText and reports chapterCount', async () => {
    createTxtText.mockResolvedValueOnce({
      text: {
        id: 'text-2',
        ownerId: USER.id,
        language: 'hi',
        title: 'Big book',
        sourceType: 'txt',
        status: 'pending',
        visibility: 'private',
        createdAt: new Date('2026-04-27T00:00:00Z'),
      },
      chapter: { id: 'c0' },
      chapters: [{ id: 'c0' }, { id: 'c1' }, { id: 'c2' }],
    });
    const res = (await callPost({
      sourceType: 'txt',
      language: 'hi',
      title: 'Big book',
      body: 'first.\n---\nsecond.\n---\nthird.',
    })) as Response;
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.text.sourceType).toBe('txt');
    expect(json.chapterCount).toBe(3);
    expect(createTxtText).toHaveBeenCalledTimes(1);
    expect(createPastedText).not.toHaveBeenCalled();
  });

  it('rejects an unsupported language with 400 before calling the service', async () => {
    const res = (await callPost({
      language: 'xx',
      title: 'X',
      body: 'hello',
    })) as { status: number };
    expect(res.status).toBe(400);
    expect(createPastedText).not.toHaveBeenCalled();
  });

  it('rejects an empty title with 400', async () => {
    const res = (await callPost({
      language: 'hi',
      title: '',
      body: 'hello',
    })) as { status: number };
    expect(res.status).toBe(400);
  });

  it('rejects an empty body with 400', async () => {
    const res = (await callPost({
      language: 'hi',
      title: 'X',
      body: '',
    })) as { status: number };
    expect(res.status).toBe(400);
  });

  it('maps TextValidationError(400) to 400', async () => {
    const { TextValidationError } = await import(
      '$lib/server/texts/upload.js'
    );
    createPastedText.mockRejectedValueOnce(
      new TextValidationError('body cannot be empty'),
    );
    const res = (await callPost({
      language: 'hi',
      title: 'X',
      body: 'hello',
    })) as { status: number };
    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = (await callPost(
      { language: 'hi', title: 'X', body: 'hello' },
      null,
    )) as { status: number };
    expect(res.status).toBe(401);
    expect(createPastedText).not.toHaveBeenCalled();
  });

  it('returns 429 when the daily upload rate limit is exceeded (T-11.2)', async () => {
    const { RequestRateLimitError } = await import(
      '$lib/server/auth/rate-limits.js'
    );
    consumeRateLimit.mockRejectedValueOnce(
      new RequestRateLimitError(86_400, 50, 'user'),
    );
    const res = (await callPost({
      language: 'hi',
      title: 'X',
      body: 'hello',
    })) as Response;
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('86400');
    const json = await res.json();
    expect(json.error).toBe('rate_limited');
    expect(createPastedText).not.toHaveBeenCalled();
  });
});

const PAGE = { cards: [], totalCount: 0, limit: 20, offset: 0 };

async function callGet(query = '', user: typeof USER | null = USER) {
  if (user) {
    requireUser.mockResolvedValueOnce(user);
  } else {
    requireUser.mockImplementationOnce(() => {
      throw { status: 401, body: { message: 'Unauthorized' } };
    });
  }
  const { GET } = await import('./+server.js');
  const url = `http://x/api/v1/texts${query}`;
  const event = {
    url: new URL(url),
    request: new Request(url),
  } as unknown as Parameters<GetFn>[0];
  try {
    return await GET(event);
  } catch (e) {
    return e as { status: number };
  }
}

describe('GET /api/v1/texts', () => {
  it('defaults to owned scope and returns the page', async () => {
    listOwnedTexts.mockResolvedValueOnce({ ...PAGE, totalCount: 2 });
    const res = (await callGet('')) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.totalCount).toBe(2);
    expect(listOwnedTexts).toHaveBeenCalledWith(
      { id: USER.id },
      { limit: undefined, offset: undefined, language: undefined },
    );
    expect(listOfficialTexts).not.toHaveBeenCalled();
  });

  it('serves official scope without requiring auth', async () => {
    listOfficialTexts.mockResolvedValueOnce(PAGE);
    const res = (await callGet('?scope=official', null)) as Response;
    expect(res.status).toBe(200);
    expect(listOfficialTexts).toHaveBeenCalledTimes(1);
    expect(requireUser).not.toHaveBeenCalled();
  });

  it('passes language + pagination through to the shared query', async () => {
    listSharedTexts.mockResolvedValueOnce(PAGE);
    await callGet('?scope=shared&language=hi&limit=5&offset=10');
    expect(listSharedTexts).toHaveBeenCalledWith(
      { id: USER.id },
      { limit: 5, offset: 10, language: 'hi' },
    );
  });

  it('rejects an unsupported language with 400', async () => {
    const res = (await callGet('?language=xx')) as { status: number };
    expect(res.status).toBe(400);
    expect(listOwnedTexts).not.toHaveBeenCalled();
  });

  it('rejects an unknown scope with 400', async () => {
    const res = (await callGet('?scope=bogus')) as { status: number };
    expect(res.status).toBe(400);
  });

  it('returns 401 for owned scope when unauthenticated', async () => {
    const res = (await callGet('?scope=owned', null)) as { status: number };
    expect(res.status).toBe(401);
    expect(listOwnedTexts).not.toHaveBeenCalled();
  });
});
