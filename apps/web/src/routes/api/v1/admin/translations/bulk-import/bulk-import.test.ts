// @vitest-environment node
/**
 * Route tests for POST /api/v1/admin/translations/bulk-import (T-3.9).
 *
 * The service is fully unit-tested in `bulk.test.ts`; this suite is just
 * the request → service handoff: zod validation, error mapping, JSON
 * shape, auth.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bulkImportTranslations = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/dictionary/bulk.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/dictionary/bulk.js')>(
    '$lib/server/dictionary/bulk.js',
  );
  return {
    ...actual,
    bulkImportTranslations: (...a: unknown[]) => bulkImportTranslations(...a),
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
    request: new Request('http://x/api/v1/admin/translations/bulk-import', {
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
  bulkImportTranslations.mockReset();
  requireUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('POST /api/v1/admin/translations/bulk-import', () => {
  it('returns the service result on a happy path', async () => {
    bulkImportTranslations.mockResolvedValueOnce({ inserted: 2, skipped: [] });
    const res = (await callPost({
      rows: [
        { language: 'hi', headword: 'बोलना', pos: 'verb', body: 'to speak' },
        { language: 'hi', headword: 'सोना', pos: 'noun', body: 'gold' },
      ],
      reason: 'Importing curator gloss CSV',
    })) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ inserted: 2, skipped: [] });
    expect(bulkImportTranslations).toHaveBeenCalledWith(
      ADMIN,
      [
        { language: 'hi', headword: 'बोलना', pos: 'verb', body: 'to speak' },
        { language: 'hi', headword: 'सोना', pos: 'noun', body: 'gold' },
      ],
      'Importing curator gloss CSV',
      {},
    );
  });

  it('forwards the optional `defaults` block to the service', async () => {
    bulkImportTranslations.mockResolvedValueOnce({ inserted: 1, skipped: [] });
    await callPost({
      rows: [{ language: 'hi', headword: 'बोलना', pos: 'verb', body: 'to speak' }],
      reason: 'CSV import',
      defaults: { sourceAttribution: 'My CSV 2026' },
    });
    expect(bulkImportTranslations).toHaveBeenCalledWith(
      ADMIN,
      expect.any(Array),
      'CSV import',
      { sourceAttribution: 'My CSV 2026' },
    );
  });

  it('rejects an empty rows[] with 400', async () => {
    const res = (await callPost({ rows: [], reason: 'noop' })) as { status: number };
    expect(res.status).toBe(400);
    expect(bulkImportTranslations).not.toHaveBeenCalled();
  });

  it('rejects a too-short reason with 400', async () => {
    const res = (await callPost({
      rows: [{ language: 'hi', headword: 'बोलना', pos: 'verb', body: 'to speak' }],
      reason: 'x',
    })) as { status: number };
    expect(res.status).toBe(400);
  });

  it('maps ForbiddenError to 403', async () => {
    const { ForbiddenError } = await import('$lib/server/dictionary/permissions.js');
    bulkImportTranslations.mockRejectedValueOnce(new ForbiddenError('admin only'));
    const res = (await callPost({
      rows: [{ language: 'hi', headword: 'बोलना', pos: 'verb', body: 'to speak' }],
      reason: 'attempt as curator',
    })) as { status: number };
    expect(res.status).toBe(403);
  });

  it('maps CuratorValidationError to its status', async () => {
    const { CuratorValidationError } = await import(
      '$lib/server/dictionary/curator.js'
    );
    bulkImportTranslations.mockRejectedValueOnce(
      new CuratorValidationError('rows is empty', 400),
    );
    const res = (await callPost({
      rows: [{ language: 'hi', headword: 'बोलना', pos: 'verb', body: 'to speak' }],
      reason: 'forced',
    })) as { status: number };
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON', async () => {
    requireUser.mockResolvedValueOnce(ADMIN);
    const { POST } = await import('./+server.js');
    const event = {
      params: {},
      request: new Request('http://x/api/v1/admin/translations/bulk-import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      }),
    } as unknown as Parameters<PostFn>[0];
    let status = 0;
    try {
      await POST(event);
    } catch (e) {
      status = (e as { status: number }).status;
    }
    expect(status).toBe(400);
  });
});
