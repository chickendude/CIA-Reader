// @vitest-environment node
/**
 * Route tests for GET /api/v1/me/collections.
 *
 * The Android library reads this listing to render its book cards, so
 * the response must carry the per-collection `estimatedComprehensionPct`
 * the badge renders. These tests assert the field is surfaced (and that
 * auth is enforced) while mocking the DB-side service.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listCollectionsForUser = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/collections.js', () => ({
  listCollectionsForUser: (...a: unknown[]) => listCollectionsForUser(...a),
}));

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

type GetFn = (typeof import('./+server.js'))['GET'];

const USER = { id: 'user-1', role: 'user' as const };

async function callGet(user: typeof USER | null = USER) {
  if (user) {
    requireUser.mockResolvedValueOnce(user);
  } else {
    requireUser.mockImplementationOnce(() => {
      throw { status: 401, body: { message: 'Unauthorized' } };
    });
  }
  const { GET } = await import('./+server.js');
  const url = 'http://x/api/v1/me/collections';
  const event = {
    url: new URL(url),
    request: new Request(url),
  } as unknown as Parameters<GetFn>[0];
  try {
    return await GET(event);
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  listCollectionsForUser.mockReset();
  requireUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('GET /api/v1/me/collections', () => {
  it("surfaces each collection's estimatedComprehensionPct for the caller", async () => {
    listCollectionsForUser.mockResolvedValueOnce([
      {
        collection: { id: 'c1', title: 'Book One', language: 'hi', kind: 'chapter_book' },
        textCount: 3,
        openTextId: 't1',
        estimatedComprehensionPct: 85,
      },
      {
        // Unprocessed book — comprehension is null so the UI shows a dash.
        collection: { id: 'c2', title: 'Book Two', language: 'hi', kind: 'chapter_book' },
        textCount: 1,
        openTextId: null,
        estimatedComprehensionPct: null,
      },
    ]);

    const res = (await callGet()) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(listCollectionsForUser).toHaveBeenCalledWith('user-1');
    expect(json.collections.map((c: { estimatedComprehensionPct: number | null }) => c.estimatedComprehensionPct)).toEqual([
      85,
      null,
    ]);
  });

  it('returns 401 when unauthenticated and never queries', async () => {
    const res = (await callGet(null)) as { status: number };
    expect(res.status).toBe(401);
    expect(listCollectionsForUser).not.toHaveBeenCalled();
  });
});
