// @vitest-environment node
/**
 * Route tests for PATCH /api/v1/admin/lemmas/:id/lock (T-3.7).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const setLemmaLock = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/dictionary/curator.js', async () => {
  const actual = await vi.importActual<
    typeof import('$lib/server/dictionary/curator.js')
  >('$lib/server/dictionary/curator.js');
  return {
    ...actual,
    setLemmaLock: (...a: unknown[]) => setLemmaLock(...a),
  };
});

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

type PatchFn = (typeof import('./+server.js'))['PATCH'];

const VALID_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ADMIN = { id: 'admin-1', role: 'admin' as const };

async function callPatch(body: unknown, user = ADMIN, id = VALID_ID) {
  requireUser.mockResolvedValueOnce(user);
  const { PATCH } = await import('./+server.js');
  const event = {
    params: { id },
    request: new Request(`http://x/api/v1/admin/lemmas/${id}/lock`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as Parameters<PatchFn>[0];
  try {
    return await PATCH(event);
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  setLemmaLock.mockReset();
  requireUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('PATCH /api/v1/admin/lemmas/:id/lock', () => {
  it('flips the lock flag and returns 200', async () => {
    setLemmaLock.mockResolvedValueOnce({
      id: VALID_ID,
      curatorLocked: true,
    });
    const res = (await callPatch({
      locked: true,
      reason: 'Protect curated entry',
    })) as Response;
    expect(res.status).toBe(200);
    expect(setLemmaLock).toHaveBeenCalledWith(
      ADMIN,
      VALID_ID,
      true,
      'Protect curated entry',
    );
  });

  it('rejects a non-boolean locked value', async () => {
    const res = (await callPatch({
      locked: 'yes',
      reason: 'ok',
    })) as { status: number };
    expect(res.status).toBe(400);
    expect(setLemmaLock).not.toHaveBeenCalled();
  });

  it('returns 400 on malformed id', async () => {
    const res = (await callPatch(
      { locked: true, reason: 'ok' },
      ADMIN,
      'bad',
    )) as { status: number };
    expect(res.status).toBe(400);
  });
});
