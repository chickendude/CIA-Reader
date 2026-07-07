// @vitest-environment node
/**
 * Route tests for POST /api/v1/translations (T-3.2).
 *
 * The service layer's behavior is already covered by
 * `translations.test.ts`; here we only care about the HTTP shape — auth
 * gate, status codes, rate-limit headers, and JSON envelope.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonContract } from '$lib/test/json-contract.js';

const submitUserTranslation = vi.fn();
const requireUser = vi.fn();
const consumeRateLimit = vi.fn();

vi.mock('$lib/server/dictionary/translations.js', async () => {
  const actual = await vi.importActual<
    typeof import('$lib/server/dictionary/translations.js')
  >('$lib/server/dictionary/translations.js');
  return {
    ...actual,
    submitUserTranslation: (...a: unknown[]) => submitUserTranslation(...a),
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

type PostFn = (typeof import('./+server.js'))['POST'];
type PostEvent = Parameters<PostFn>[0];

async function callPost(body: unknown, user: { id: string } | null = { id: 'u1' }) {
  if (user) {
    requireUser.mockResolvedValueOnce(user);
  } else {
    requireUser.mockImplementationOnce(() => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 });
    });
  }
  const { POST } = await import('./+server.js');
  const event = {
    request: new Request('http://x/api/v1/translations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as PostEvent;
  try {
    return await POST(event);
  } catch (e) {
    // `throw error(...)` in SvelteKit produces an HttpError-shaped object.
    return e as { status: number; body?: { message: string } };
  }
}

beforeEach(() => {
  submitUserTranslation.mockReset();
  requireUser.mockReset();
  consumeRateLimit.mockReset();
  consumeRateLimit.mockResolvedValue({
    limit: 30,
    remaining: 29,
    subjectType: 'user',
  });
});

afterEach(() => {
  vi.resetModules();
});

describe('POST /api/v1/translations', () => {
  it('returns 201 with the public translation shape on success', async () => {
    submitUserTranslation.mockResolvedValueOnce({
      id: 'tr-1',
      lemmaId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      targetType: 'lemma',
      targetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      source: 'user',
      submittedBy: 'u1',
      parentTranslationId: null,
      body: 'to speak',
      targetLanguage: 'en',
      sourceAttribution: null,
      sourceId: null,
      hidden: false,
      createdAt: new Date('2026-04-24T00:00:00Z'),
      updatedAt: new Date('2026-04-24T00:00:00Z'),
    });

    const res = (await callPost({
      lemmaId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      body: 'to speak',
    })) as Response;
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.translation).toMatchObject({
      id: 'tr-1',
      source: 'user',
      submittedBy: 'u1',
      body: 'to speak',
    });
    // Never leaks sourceId on user submissions (it's always null, but
    // ensure we send the stable public shape).
    expect(json.translation.sourceId).toBeUndefined();
    expect(jsonContract(json)).toMatchInlineSnapshot(`
      {
        "translation": {
          "body": "string",
          "createdAt": "string",
          "hidden": "boolean",
          "id": "string",
          "parentTranslationId": "null",
          "source": "string",
          "sourceAttribution": "null",
          "submittedBy": "string",
          "targetId": "string",
          "targetLanguage": "string",
          "targetType": "string",
          "updatedAt": "string",
        },
      }
    `);
    expect(res.headers.get('x-ratelimit-remaining')).toBe('29');
  });

  it('skips the community rate limiter for a private note and echoes isPrivate', async () => {
    submitUserTranslation.mockResolvedValueOnce({
      id: 'tr-p',
      targetType: 'lemma',
      targetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      source: 'user',
      submittedBy: 'u1',
      parentTranslationId: null,
      body: 'secret',
      targetLanguage: 'en',
      sourceAttribution: null,
      sourceId: null,
      hidden: false,
      isPrivate: true,
      createdAt: new Date('2026-04-24T00:00:00Z'),
      updatedAt: new Date('2026-04-24T00:00:00Z'),
    });

    const res = (await callPost({
      lemmaId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      body: 'secret',
      isPrivate: true,
    })) as Response;

    expect(res.status).toBe(201);
    // The shared-dictionary rate limiter is never consulted for private notes.
    expect(consumeRateLimit).not.toHaveBeenCalled();
    expect(submitUserTranslation).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ isPrivate: true }),
    );
    const json = await res.json();
    expect(json.translation.isPrivate).toBe(true);
    // No rate-limit headers on the exempt path.
    expect(res.headers.get('x-ratelimit-remaining')).toBeNull();
  });

  it('propagates auth failures as 401', async () => {
    const res = (await callPost(
      { lemmaId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', body: 'x' },
      null,
    )) as { status: number };
    expect(res.status).toBe(401);
    expect(submitUserTranslation).not.toHaveBeenCalled();
  });

  it('returns 429 when the request token/device bucket is rate-limited', async () => {
    const { RequestRateLimitError } = await import('$lib/server/auth/rate-limits.js');
    consumeRateLimit.mockRejectedValueOnce(new RequestRateLimitError(3600, 30, 'api_key'));

    const res = (await callPost({
      lemmaId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      body: 'x',
    })) as Response;

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('3600');
    expect(res.headers.get('x-ratelimit-subject')).toBe('api_key');
    expect(submitUserTranslation).not.toHaveBeenCalled();
  });

  it('returns 400 when the body fails Zod validation (e.g. non-uuid lemmaId)', async () => {
    const res = (await callPost({ lemmaId: 'not-a-uuid', body: 'x' })) as {
      status: number;
    };
    expect(res.status).toBe(400);
    expect(submitUserTranslation).not.toHaveBeenCalled();
  });

  it('returns 400 with the validation message when the service rejects the input', async () => {
    const { TranslationValidationError } = await import(
      '$lib/server/dictionary/translations.js'
    );
    submitUserTranslation.mockRejectedValueOnce(
      new TranslationValidationError('Lemma not found', 404),
    );
    const res = (await callPost({
      lemmaId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      body: 'x',
    })) as { status: number };
    expect(res.status).toBe(404);
  });

  it('returns 429 with Retry-After when the user is rate-limited', async () => {
    const { TranslationRateLimitError } = await import(
      '$lib/server/dictionary/translations.js'
    );
    submitUserTranslation.mockRejectedValueOnce(new TranslationRateLimitError(3600, 30));
    const res = (await callPost({
      lemmaId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      body: 'x',
    })) as Response;
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('3600');
    expect(res.headers.get('x-ratelimit-limit')).toBe('30');
    expect(res.headers.get('x-ratelimit-remaining')).toBe('0');
    const json = await res.json();
    expect(json.error).toBe('rate_limited');
    expect(json.retryAfterSeconds).toBe(3600);
  });
});
