// @vitest-environment node
/**
 * Route tests for PATCH /api/v1/admin/lemmas/:id/translations/reorder (T-3.13).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const reorderTranslations = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/dictionary/curator.js', async () => {
  const actual = await vi.importActual<
    typeof import('$lib/server/dictionary/curator.js')
  >('$lib/server/dictionary/curator.js');
  return {
    ...actual,
    reorderTranslations: (...a: unknown[]) => reorderTranslations(...a),
  };
});

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

type PatchFn = (typeof import('./+server.js'))['PATCH'];

const LEMMA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const T1 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const T2 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ADMIN = { id: 'admin-1', role: 'admin' as const };

async function callPatch(body: unknown, user = ADMIN, id = LEMMA) {
  requireUser.mockResolvedValueOnce(user);
  const { PATCH } = await import('./+server.js');
  const event = {
    params: { id },
    request: new Request(`http://x/api/v1/admin/lemmas/${id}/translations/reorder`, {
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
  reorderTranslations.mockReset();
  requireUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('PATCH /api/v1/admin/lemmas/:id/translations/reorder', () => {
  it('returns the new ordered translations on success', async () => {
    reorderTranslations.mockResolvedValueOnce([
      { id: T1, displayRank: 0 },
      { id: T2, displayRank: 1 },
    ]);
    const res = (await callPatch({
      orderedTranslationIds: [T1, T2],
      reason: 'Pinning the more idiomatic gloss first',
    })) as Response;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.translations).toEqual([
      { id: T1, displayRank: 0 },
      { id: T2, displayRank: 1 },
    ]);
    expect(reorderTranslations).toHaveBeenCalledWith(
      ADMIN,
      LEMMA,
      [T1, T2],
      'Pinning the more idiomatic gloss first',
    );
  });

  it('returns 400 when an id is not a UUID', async () => {
    const res = (await callPatch({
      orderedTranslationIds: ['not-a-uuid'],
      reason: 'oops',
    })) as { status: number };
    expect(res.status).toBe(400);
    expect(reorderTranslations).not.toHaveBeenCalled();
  });

  it('returns 400 when the lemma id in the URL is malformed', async () => {
    const res = (await callPatch(
      {
        orderedTranslationIds: [T1, T2],
        reason: 'order',
      },
      ADMIN,
      'not-a-uuid',
    )) as { status: number };
    expect(res.status).toBe(400);
    expect(reorderTranslations).not.toHaveBeenCalled();
  });

  it('maps a 409 from a partial-order rejection', async () => {
    const { CuratorValidationError } = await import(
      '$lib/server/dictionary/curator.js'
    );
    reorderTranslations.mockRejectedValueOnce(
      new CuratorValidationError(
        'orderedTranslationIds must contain exactly the translations on this lemma — re-fetch and try again',
        409,
      ),
    );
    const res = (await callPatch({
      orderedTranslationIds: [T1],
      reason: 'partial reorder',
    })) as { status: number };
    expect(res.status).toBe(409);
  });

  it('maps a ForbiddenError from a non-curator caller as 403', async () => {
    const { ForbiddenError } = await import(
      '$lib/server/dictionary/permissions.js'
    );
    reorderTranslations.mockRejectedValueOnce(
      new ForbiddenError('Not allowed to edit hi'),
    );
    const res = (await callPatch({
      orderedTranslationIds: [T1, T2],
      reason: 'forbidden test',
    })) as { status: number };
    expect(res.status).toBe(403);
  });

  it('rejects an empty ordered list with 400', async () => {
    const res = (await callPatch({
      orderedTranslationIds: [],
      reason: 'empty',
    })) as { status: number };
    expect(res.status).toBe(400);
  });
});
