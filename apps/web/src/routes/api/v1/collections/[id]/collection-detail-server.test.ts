// @vitest-environment node
/**
 * Route tests for GET /api/v1/collections/:id (collection detail).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadCollectionDetail = vi.fn();
const viewerHasCollectionShare = vi.fn();
const resolveUser = vi.fn();

vi.mock('$lib/server/collections.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/collections.js')>(
    '$lib/server/collections.js',
  );
  return {
    ...actual,
    loadCollectionDetail: (...a: unknown[]) => loadCollectionDetail(...a),
    viewerHasCollectionShare: (...a: unknown[]) => viewerHasCollectionShare(...a),
  };
});

vi.mock('$lib/server/auth/require-user.js', () => ({
  resolveUser: (...a: unknown[]) => resolveUser(...a),
  requireUser: (...a: unknown[]) => resolveUser(...a),
}));

type GetFn = (typeof import('./+server.js'))['GET'];

const ID = '11111111-1111-1111-1111-111111111111';
const OWNER = { id: 'owner-1', role: 'user' as const };

function detail(collectionOverrides: Record<string, unknown> = {}) {
  const ts = new Date('2026-04-27T00:00:00Z');
  return {
    collection: {
      id: ID,
      ownerId: OWNER.id,
      language: 'hi',
      kind: 'chapter_book',
      title: 'Book',
      description: null,
      coverUrl: null,
      visibility: 'private',
      createdAt: ts,
      updatedAt: ts,
      ...collectionOverrides,
    },
    items: [
      {
        position: 0,
        sectionTitle: null,
        text: {
          id: 'text-1',
          ownerId: OWNER.id,
          language: 'hi',
          title: 'Ch 1',
          sourceType: 'epub',
          status: 'ready',
          visibility: 'private',
          createdAt: ts,
          updatedAt: ts,
        },
      },
    ],
  };
}

async function callGet(id = ID, viewer: { id: string; role: 'user' | 'admin' } | null = OWNER) {
  resolveUser.mockResolvedValueOnce(viewer);
  const { GET } = await import('./+server.js');
  const event = {
    params: { id },
    request: new Request('http://x'),
    url: new URL('http://x'),
  } as unknown as Parameters<GetFn>[0];
  try {
    return await GET(event);
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  loadCollectionDetail.mockReset();
  viewerHasCollectionShare.mockReset();
  resolveUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('GET /api/v1/collections/:id', () => {
  it('rejects a non-UUID id with 400 before any lookup', async () => {
    const res = (await callGet('not-a-uuid')) as { status: number };
    expect(res.status).toBe(400);
    expect(loadCollectionDetail).not.toHaveBeenCalled();
  });

  it('404s when the collection does not exist', async () => {
    loadCollectionDetail.mockResolvedValueOnce(null);
    const res = (await callGet()) as { status: number };
    expect(res.status).toBe(404);
  });

  it('returns the collection + projected items for the owner', async () => {
    loadCollectionDetail.mockResolvedValueOnce(detail());
    const res = (await callGet()) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.collection.id).toBe(ID);
    expect(json.items).toHaveLength(1);
    expect(json.items[0]).toMatchObject({ position: 0, sectionTitle: null });
    expect(json.items[0].text).toMatchObject({ id: 'text-1', title: 'Ch 1' });
  });

  it('404s a private collection for a non-owner without a share', async () => {
    loadCollectionDetail.mockResolvedValueOnce(detail());
    viewerHasCollectionShare.mockResolvedValueOnce(false);
    const res = (await callGet(ID, { id: 'someone-else', role: 'user' })) as {
      status: number;
    };
    expect(res.status).toBe(404);
  });

  it('allows a non-owner who has a share grant', async () => {
    loadCollectionDetail.mockResolvedValueOnce(detail());
    viewerHasCollectionShare.mockResolvedValueOnce(true);
    const res = (await callGet(ID, { id: 'someone-else', role: 'user' })) as Response;
    expect(res.status).toBe(200);
  });

  it('serves an official collection to anyone, no auth or share check', async () => {
    loadCollectionDetail.mockResolvedValueOnce(detail({ visibility: 'official' }));
    const res = (await callGet(ID, null)) as Response;
    expect(res.status).toBe(200);
    expect(viewerHasCollectionShare).not.toHaveBeenCalled();
  });
});
