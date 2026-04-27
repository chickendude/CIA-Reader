// @vitest-environment node
/**
 * Route tests for POST /api/v1/admin/lemmas/:id/merge (T-3.7).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mergeLemmas = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/dictionary/curator.js', async () => {
  const actual = await vi.importActual<
    typeof import('$lib/server/dictionary/curator.js')
  >('$lib/server/dictionary/curator.js');
  return {
    ...actual,
    mergeLemmas: (...a: unknown[]) => mergeLemmas(...a),
  };
});

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

type PostFn = (typeof import('./+server.js'))['POST'];

const WINNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const LOSER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ADMIN = { id: 'admin-1', role: 'admin' as const };

async function callPost(body: unknown, user = ADMIN, id = WINNER) {
  requireUser.mockResolvedValueOnce(user);
  const { POST } = await import('./+server.js');
  const event = {
    params: { id },
    request: new Request(`http://x/api/v1/admin/lemmas/${id}/merge`, {
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
  mergeLemmas.mockReset();
  requireUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('POST /api/v1/admin/lemmas/:id/merge', () => {
  it('merges and returns movement counts', async () => {
    mergeLemmas.mockResolvedValueOnce({
      winner: { id: WINNER, language: 'hi' },
      translationsMoved: 3,
      formsMoved: 2,
    });
    const res = (await callPost({
      loserId: LOSER,
      reason: 'Duplicate import',
    })) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.translationsMoved).toBe(3);
    expect(json.formsMoved).toBe(2);
    expect(mergeLemmas).toHaveBeenCalledWith(
      ADMIN,
      { winnerId: WINNER, loserId: LOSER },
      'Duplicate import',
    );
  });

  it('returns 400 when loserId is not a UUID', async () => {
    const res = (await callPost({
      loserId: 'nope',
      reason: 'dup',
    })) as { status: number };
    expect(res.status).toBe(400);
    expect(mergeLemmas).not.toHaveBeenCalled();
  });

  it('maps CuratorValidationError(409) from cross-language merge', async () => {
    const { CuratorValidationError } = await import(
      '$lib/server/dictionary/curator.js'
    );
    mergeLemmas.mockRejectedValueOnce(
      new CuratorValidationError('Cannot merge lemmas across languages', 409),
    );
    const res = (await callPost({
      loserId: LOSER,
      reason: 'x',
    })) as { status: number };
    expect(res.status).toBe(409);
  });
});
