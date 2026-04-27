// @vitest-environment node
/**
 * Route tests for POST /api/v1/admin/translations/bulk-attribution (T-3.9).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bulkUpdateAttribution = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/dictionary/bulk.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/dictionary/bulk.js')>(
    '$lib/server/dictionary/bulk.js',
  );
  return {
    ...actual,
    bulkUpdateAttribution: (...a: unknown[]) => bulkUpdateAttribution(...a),
  };
});

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

type PostFn = (typeof import('./+server.js'))['POST'];

const ADMIN = { id: 'admin-1', role: 'admin' as const };

async function callPost(body: unknown, user = ADMIN) {
  requireUser.mockResolvedValueOnce(user);
  const { POST } = await import('./+server.js');
  const event = {
    params: {},
    request: new Request('http://x/api/v1/admin/translations/bulk-attribution', {
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
  bulkUpdateAttribution.mockReset();
  requireUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('POST /api/v1/admin/translations/bulk-attribution', () => {
  it('updates attribution and returns the count', async () => {
    bulkUpdateAttribution.mockResolvedValueOnce({ updated: 5 });
    const res = (await callPost({
      source: 'official_dictionary',
      oldAttribution: 'Hindi WordNet',
      newAttribution: 'Hindi WordNet (CFILT, IIT-Bombay)',
      reason: 'Add full attribution to imported rows',
    })) as Response;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 5 });
    expect(bulkUpdateAttribution).toHaveBeenCalledWith(
      ADMIN,
      {
        source: 'official_dictionary',
        oldAttribution: 'Hindi WordNet',
        newAttribution: 'Hindi WordNet (CFILT, IIT-Bombay)',
        language: undefined,
      },
      'Add full attribution to imported rows',
    );
  });

  it('passes language scope when provided', async () => {
    bulkUpdateAttribution.mockResolvedValueOnce({ updated: 3 });
    await callPost({
      source: 'official_dictionary',
      oldAttribution: 'Old',
      newAttribution: null,
      language: 'or',
      reason: 'Clear obsolete attribution on Odia rows',
    });
    expect(bulkUpdateAttribution).toHaveBeenCalledWith(
      ADMIN,
      expect.objectContaining({ language: 'or', newAttribution: null }),
      'Clear obsolete attribution on Odia rows',
    );
  });

  it('rejects an unsupported source with 400', async () => {
    const res = (await callPost({
      source: 'user',
      oldAttribution: 'Old',
      newAttribution: 'New',
      reason: 'forced',
    })) as { status: number };
    expect(res.status).toBe(400);
    expect(bulkUpdateAttribution).not.toHaveBeenCalled();
  });

  it('rejects an empty oldAttribution with 400 (zod min)', async () => {
    const res = (await callPost({
      source: 'official_dictionary',
      oldAttribution: '',
      newAttribution: 'New',
      reason: 'forced',
    })) as { status: number };
    expect(res.status).toBe(400);
  });

  it('rejects an unsupported language code', async () => {
    const res = (await callPost({
      source: 'official_dictionary',
      oldAttribution: 'Old',
      newAttribution: 'New',
      language: 'xx',
      reason: 'forced',
    })) as { status: number };
    expect(res.status).toBe(400);
  });

  it('maps ForbiddenError to 403', async () => {
    const { ForbiddenError } = await import('$lib/server/dictionary/permissions.js');
    bulkUpdateAttribution.mockRejectedValueOnce(new ForbiddenError('admin only'));
    const res = (await callPost({
      source: 'official_dictionary',
      oldAttribution: 'Old',
      newAttribution: 'New',
      reason: 'attempt as curator',
    })) as { status: number };
    expect(res.status).toBe(403);
  });

  it('maps over-cap CuratorValidationError to 400', async () => {
    const { CuratorValidationError } = await import(
      '$lib/server/dictionary/curator.js'
    );
    bulkUpdateAttribution.mockRejectedValueOnce(
      new CuratorValidationError('would touch too many', 400),
    );
    const res = (await callPost({
      source: 'official_dictionary',
      oldAttribution: 'Old',
      newAttribution: 'New',
      reason: 'too broad',
    })) as { status: number };
    expect(res.status).toBe(400);
  });
});
