// @vitest-environment node
/**
 * Route tests for POST /api/v1/admin/lemmas/:id/split (T-3.7).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const splitLemma = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/dictionary/curator.js', async () => {
  const actual = await vi.importActual<
    typeof import('$lib/server/dictionary/curator.js')
  >('$lib/server/dictionary/curator.js');
  return {
    ...actual,
    splitLemma: (...a: unknown[]) => splitLemma(...a),
  };
});

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

type PostFn = (typeof import('./+server.js'))['POST'];

const SRC = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ADMIN = { id: 'admin-1', role: 'admin' as const };

async function callPost(body: unknown, user = ADMIN, id = SRC) {
  requireUser.mockResolvedValueOnce(user);
  const { POST } = await import('./+server.js');
  const event = {
    params: { id },
    request: new Request(`http://x/api/v1/admin/lemmas/${id}/split`, {
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
  splitLemma.mockReset();
  requireUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('POST /api/v1/admin/lemmas/:id/split', () => {
  it('creates a new lemma and returns movement counts', async () => {
    splitLemma.mockResolvedValueOnce({
      source: { id: SRC },
      created: { id: 'new-id', headword: 'सोना', pos: 'noun' },
      translationsMoved: 1,
      formsMoved: 0,
    });
    const res = (await callPost({
      newLemma: { headword: 'सोना', pos: 'noun' },
      translationIds: ['tr-1'],
      reason: 'Disambiguate gold vs sleep',
    })) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.created.headword).toBe('सोना');
    expect(json.translationsMoved).toBe(1);
  });

  it('returns 400 when newLemma is missing', async () => {
    const res = (await callPost({
      translationIds: ['tr-1'],
      reason: 'x',
    })) as { status: number };
    expect(res.status).toBe(400);
    expect(splitLemma).not.toHaveBeenCalled();
  });

  it('maps CuratorValidationError(409) when a child does not belong', async () => {
    const { CuratorValidationError } = await import(
      '$lib/server/dictionary/curator.js'
    );
    splitLemma.mockRejectedValueOnce(
      new CuratorValidationError('does not belong', 409),
    );
    const res = (await callPost({
      newLemma: { headword: 'x', pos: 'noun' },
      translationIds: ['tr-1'],
      reason: 'x',
    })) as { status: number };
    expect(res.status).toBe(409);
  });
});
