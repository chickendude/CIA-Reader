// @vitest-environment node
/**
 * Route tests for POST /api/v1/admin/translations/bulk-promote (T-3.9).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bulkPromoteTranslations = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/dictionary/bulk.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/dictionary/bulk.js')>(
    '$lib/server/dictionary/bulk.js',
  );
  return {
    ...actual,
    bulkPromoteTranslations: (...a: unknown[]) => bulkPromoteTranslations(...a),
  };
});

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

type PostFn = (typeof import('./+server.js'))['POST'];

const ADMIN = { id: 'admin-1', role: 'admin' as const };
const VALID_ID_1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const VALID_ID_2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

async function callPost(body: unknown, user = ADMIN) {
  requireUser.mockResolvedValueOnce(user);
  const { POST } = await import('./+server.js');
  const event = {
    params: {},
    request: new Request('http://x/api/v1/admin/translations/bulk-promote', {
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
  bulkPromoteTranslations.mockReset();
  requireUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('POST /api/v1/admin/translations/bulk-promote', () => {
  it('promotes a set of ids and returns the result envelope', async () => {
    bulkPromoteTranslations.mockResolvedValueOnce({
      promoted: 2,
      skipped: [],
    });
    const res = (await callPost({
      translationIds: [VALID_ID_1, VALID_ID_2],
      reason: 'Endorsing strong community submissions',
    })) as Response;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ promoted: 2, skipped: [] });
    expect(bulkPromoteTranslations).toHaveBeenCalledWith(
      ADMIN,
      [VALID_ID_1, VALID_ID_2],
      'Endorsing strong community submissions',
    );
  });

  it('rejects a non-uuid in the list with 400', async () => {
    const res = (await callPost({
      translationIds: ['not-a-uuid'],
      reason: 'forced',
    })) as { status: number };
    expect(res.status).toBe(400);
    expect(bulkPromoteTranslations).not.toHaveBeenCalled();
  });

  it('rejects an empty list with 400', async () => {
    const res = (await callPost({ translationIds: [], reason: 'noop' })) as {
      status: number;
    };
    expect(res.status).toBe(400);
  });

  it('rejects a too-short reason with 400', async () => {
    const res = (await callPost({
      translationIds: [VALID_ID_1],
      reason: 'x',
    })) as { status: number };
    expect(res.status).toBe(400);
  });

  it('maps ForbiddenError to 403', async () => {
    const { ForbiddenError } = await import('$lib/server/dictionary/permissions.js');
    bulkPromoteTranslations.mockRejectedValueOnce(
      new ForbiddenError('admin only'),
    );
    const res = (await callPost({
      translationIds: [VALID_ID_1],
      reason: 'attempt as curator',
    })) as { status: number };
    expect(res.status).toBe(403);
  });
});
