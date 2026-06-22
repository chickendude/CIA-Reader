// @vitest-environment node
/**
 * Route tests for GET /api/v1/texts/:id (text metadata + chapter list).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getReadableText = vi.fn();
const resolveUser = vi.fn();

vi.mock('$lib/server/texts/upload.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/texts/upload.js')>(
    '$lib/server/texts/upload.js',
  );
  return {
    ...actual,
    getReadableText: (...a: unknown[]) => getReadableText(...a),
  };
});

vi.mock('$lib/server/auth/require-user.js', () => ({
  resolveUser: (...a: unknown[]) => resolveUser(...a),
  requireUser: (...a: unknown[]) => resolveUser(...a),
}));

type GetFn = (typeof import('./+server.js'))['GET'];

const ID = '11111111-1111-1111-1111-111111111111';

async function callGet(id = ID, viewer: { id: string } | null = { id: 'u1' }) {
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
  getReadableText.mockReset();
  resolveUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('GET /api/v1/texts/:id', () => {
  it('rejects a non-UUID id with 400 before any lookup', async () => {
    const res = (await callGet('not-a-uuid')) as { status: number };
    expect(res.status).toBe(400);
    expect(getReadableText).not.toHaveBeenCalled();
  });

  it('404s when the text is not readable (or absent)', async () => {
    getReadableText.mockResolvedValueOnce(null);
    const res = (await callGet()) as { status: number };
    expect(res.status).toBe(404);
  });

  it('returns metadata + a lightweight chapter list (no bodies)', async () => {
    const ts = new Date('2026-06-21T00:00:00Z');
    getReadableText.mockResolvedValueOnce({
      text: {
        id: ID,
        ownerId: 'u1',
        language: 'hi',
        title: 'A Book',
        sourceType: 'epub',
        status: 'ready',
        visibility: 'private',
        createdAt: ts,
        updatedAt: ts,
      },
      chapters: [
        { id: 'c0', textId: ID, idx: 0, title: 'Ch 1', body: 'x', tokenCount: 100, createdAt: ts },
        { id: 'c1', textId: ID, idx: 1, title: null, body: 'y', tokenCount: 50, createdAt: ts },
      ],
    });

    const res = (await callGet()) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.text.title).toBe('A Book');
    expect(json.chapterCount).toBe(2);
    expect(json.chapters).toEqual([
      { idx: 0, title: 'Ch 1', tokenCount: 100 },
      { idx: 1, title: null, tokenCount: 50 },
    ]);
    // Chapter bodies are intentionally not included.
    expect(json.chapters[0].body).toBeUndefined();
  });
});
