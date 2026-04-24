// @vitest-environment node
/**
 * Route tests for PATCH /api/v1/admin/translations/:id (T-3.7).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updateTranslation = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/dictionary/curator.js', async () => {
  const actual = await vi.importActual<
    typeof import('$lib/server/dictionary/curator.js')
  >('$lib/server/dictionary/curator.js');
  return {
    ...actual,
    updateTranslation: (...a: unknown[]) => updateTranslation(...a),
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
    request: new Request(`http://x/api/v1/admin/translations/${id}`, {
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
  updateTranslation.mockReset();
  requireUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('PATCH /api/v1/admin/translations/:id', () => {
  it('promotes a community translation and returns 200', async () => {
    updateTranslation.mockResolvedValueOnce({
      id: VALID_ID,
      source: 'curator',
      body: 'to speak',
    });
    const res = (await callPatch({
      promoteToCurator: true,
      reason: 'Endorsing a strong community gloss',
    })) as Response;
    expect(res.status).toBe(200);
    expect(updateTranslation).toHaveBeenCalledWith(
      ADMIN,
      VALID_ID,
      { promoteToCurator: true },
      'Endorsing a strong community gloss',
    );
  });

  it('maps CuratorValidationError(409) when promotion is illegal', async () => {
    const { CuratorValidationError } = await import(
      '$lib/server/dictionary/curator.js'
    );
    updateTranslation.mockRejectedValueOnce(
      new CuratorValidationError('cannot re-tag', 409),
    );
    const res = (await callPatch({
      promoteToCurator: true,
      reason: 'x',
    })) as { status: number };
    expect(res.status).toBe(409);
  });

  it('returns 400 when reason is missing', async () => {
    const res = (await callPatch({
      promoteToCurator: true,
    })) as { status: number };
    expect(res.status).toBe(400);
    expect(updateTranslation).not.toHaveBeenCalled();
  });
});
