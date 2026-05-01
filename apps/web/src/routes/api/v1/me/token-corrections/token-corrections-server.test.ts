// @vitest-environment node
/**
 * Route tests for POST /api/v1/me/token-corrections (T-6.1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const writeTokenCorrection = vi.fn();
const requireUser = vi.fn();
const consumeRateLimit = vi.fn();

vi.mock('$lib/server/corrections.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/corrections.js')>(
    '$lib/server/corrections.js',
  );
  return {
    ...actual,
    writeTokenCorrection: (...a: unknown[]) => writeTokenCorrection(...a),
  };
});

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
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

type Post = (typeof import('./+server.js'))['POST'];

const TOKEN_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const LEMMA_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

async function callPost(body: unknown) {
  const { POST } = await import('./+server.js');
  const event = {
    request: new Request('http://x/api/v1/me/token-corrections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as Parameters<Post>[0];
  try {
    return (await POST(event)) as Response;
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  writeTokenCorrection.mockReset();
  requireUser.mockReset();
  requireUser.mockResolvedValue({ id: 'u1' });
  consumeRateLimit.mockReset();
  consumeRateLimit.mockResolvedValue({
    limit: 200,
    remaining: 199,
    subjectType: 'user',
  });
});

afterEach(() => vi.resetModules());

describe('POST /api/v1/me/token-corrections', () => {
  it('writes a pick_candidate correction', async () => {
    writeTokenCorrection.mockResolvedValueOnce({
      userId: 'u1',
      tokenId: TOKEN_ID,
      type: 'pick_candidate',
      chosenLemmaId: LEMMA_ID,
    });
    const res = (await callPost({
      tokenId: TOKEN_ID,
      type: 'pick_candidate',
      chosenLemmaId: LEMMA_ID,
    })) as Response;
    expect(res.status).toBe(201);
    expect(writeTokenCorrection).toHaveBeenCalledWith({
      userId: 'u1',
      tokenId: TOKEN_ID,
      type: 'pick_candidate',
      chosenLemmaId: LEMMA_ID,
      note: null,
    });
  });

  it('writes a mark_proper_noun correction with no lemma', async () => {
    writeTokenCorrection.mockResolvedValueOnce({
      userId: 'u1',
      tokenId: TOKEN_ID,
      type: 'mark_proper_noun',
      chosenLemmaId: null,
    });
    const res = (await callPost({
      tokenId: TOKEN_ID,
      type: 'mark_proper_noun',
    })) as Response;
    expect(res.status).toBe(201);
  });

  it('rejects an unknown correction type with 400', async () => {
    const r = (await callPost({
      tokenId: TOKEN_ID,
      type: 'totally_made_up',
      chosenLemmaId: LEMMA_ID,
    })) as { status: number };
    expect(r.status).toBe(400);
    expect(writeTokenCorrection).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid tokenId with 400', async () => {
    const r = (await callPost({
      tokenId: 'not-a-uuid',
      type: 'mark_foreign',
    })) as { status: number };
    expect(r.status).toBe(400);
  });

  it('surfaces a 404 when the service reports missing token / lemma', async () => {
    const { CorrectionValidationError } = await import(
      '$lib/server/corrections.js'
    );
    writeTokenCorrection.mockRejectedValueOnce(
      new CorrectionValidationError('token not found', 404),
    );
    const r = (await callPost({
      tokenId: TOKEN_ID,
      type: 'mark_foreign',
    })) as { status: number };
    expect(r.status).toBe(404);
  });
});
