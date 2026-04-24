// @vitest-environment node
/**
 * Route tests for PATCH /api/v1/admin/translations/:id/hidden (T-3.7).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const setTranslationHidden = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/dictionary/curator.js', async () => {
  const actual = await vi.importActual<
    typeof import('$lib/server/dictionary/curator.js')
  >('$lib/server/dictionary/curator.js');
  return {
    ...actual,
    setTranslationHidden: (...a: unknown[]) => setTranslationHidden(...a),
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
    request: new Request(`http://x/api/v1/admin/translations/${id}/hidden`, {
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
  setTranslationHidden.mockReset();
  requireUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('PATCH /api/v1/admin/translations/:id/hidden', () => {
  it('hides a community translation', async () => {
    setTranslationHidden.mockResolvedValueOnce({
      id: VALID_ID,
      hidden: true,
    });
    const res = (await callPatch({
      hidden: true,
      reason: 'Spam submission',
    })) as Response;
    expect(res.status).toBe(200);
    expect(setTranslationHidden).toHaveBeenCalledWith(
      ADMIN,
      VALID_ID,
      true,
      'Spam submission',
    );
  });

  it('maps CuratorValidationError(409) when hiding an official', async () => {
    const { CuratorValidationError } = await import(
      '$lib/server/dictionary/curator.js'
    );
    setTranslationHidden.mockRejectedValueOnce(
      new CuratorValidationError('Only community', 409),
    );
    const res = (await callPatch({
      hidden: true,
      reason: 'trying to hide curator',
    })) as { status: number };
    expect(res.status).toBe(409);
  });

  it('rejects a non-boolean hidden value', async () => {
    const res = (await callPatch({
      hidden: 'yes',
      reason: 'x',
    })) as { status: number };
    expect(res.status).toBe(400);
  });
});
