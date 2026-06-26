// @vitest-environment node
/**
 * Route tests for GET /api/v1/texts/:id (text metadata + chapter list).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getReadableText = vi.fn();
const updateText = vi.fn();
const resolveUser = vi.fn();
const estimatedComprehensionForText = vi.fn();

vi.mock('$lib/server/texts/upload.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/texts/upload.js')>(
    '$lib/server/texts/upload.js',
  );
  return {
    ...actual,
    getReadableText: (...a: unknown[]) => getReadableText(...a),
    updateText: (...a: unknown[]) => updateText(...a),
  };
});

vi.mock('$lib/server/learning-stats.js', () => ({
  estimatedComprehensionForText: (...a: unknown[]) => estimatedComprehensionForText(...a),
}));

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

async function callPatch(
  body: unknown,
  id = ID,
  viewer: { id: string; role: 'user' | 'admin' } | null = { id: 'u1', role: 'user' },
) {
  resolveUser.mockResolvedValueOnce(viewer);
  const { PATCH } = await import('./+server.js');
  const event = {
    params: { id },
    request: new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    url: new URL('http://x'),
  } as unknown as Parameters<typeof PATCH>[0];
  try {
    return await PATCH(event);
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  getReadableText.mockReset();
  updateText.mockReset();
  resolveUser.mockReset();
  estimatedComprehensionForText.mockReset();
  estimatedComprehensionForText.mockResolvedValue(80);
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
    // Viewer-specific comprehension is attached.
    expect(json.comprehensionPct).toBe(80);
    expect(estimatedComprehensionForText).toHaveBeenCalledWith('u1', ID);
  });

  it('attaches a null comprehension for an anonymous viewer', async () => {
    getReadableText.mockResolvedValueOnce({
      text: {
        id: ID,
        ownerId: null,
        language: 'hi',
        title: 'Official',
        sourceType: 'epub',
        status: 'ready',
        visibility: 'official',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      chapters: [],
    });
    const res = (await callGet(ID, null)) as Response;
    const json = await res.json();
    expect(json.comprehensionPct).toBeNull();
    expect(estimatedComprehensionForText).not.toHaveBeenCalled();
  });

  it('PATCH renames the text and returns the updated row', async () => {
    updateText.mockResolvedValueOnce({ id: ID, title: 'Renamed' });
    const res = (await callPatch({ title: 'Renamed' })) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.text.title).toBe('Renamed');
    expect(updateText).toHaveBeenCalledWith(ID, { id: 'u1', role: 'user' }, { title: 'Renamed' });
  });

  it('PATCH maps a not-found / non-owner to 404', async () => {
    const { TextValidationError } = await vi.importActual<
      typeof import('$lib/server/texts/upload.js')
    >('$lib/server/texts/upload.js');
    updateText.mockRejectedValueOnce(new TextValidationError('Text not found', 404));
    const res = (await callPatch({ title: 'x' })) as { status: number };
    expect(res.status).toBe(404);
  });
});
