// @vitest-environment node
/**
 * Route tests for POST /api/v1/texts/epub (T-4.3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createChapterBookFromEpub = vi.fn();
const requireUser = vi.fn();
const consumeRateLimit = vi.fn();

vi.mock('$lib/server/texts/upload.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/texts/upload.js')>(
    '$lib/server/texts/upload.js',
  );
  return {
    ...actual,
    createChapterBookFromEpub: (...a: unknown[]) =>
      createChapterBookFromEpub(...a),
  };
});

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
  requireVerifiedUser: (...a: unknown[]) => requireUser(...a),
}));

vi.mock('$lib/server/auth/rate-limits.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/auth/rate-limits.js')>(
    '$lib/server/auth/rate-limits.js',
  );
  return {
    ...actual,
    consumeRateLimit: (...a: unknown[]) => consumeRateLimit(...a),
  };
});

type PostFn = (typeof import('./+server.js'))['POST'];

const USER = { id: 'user-1', role: 'user' as const };

function buildEpubFile(bytes = new Uint8Array([1, 2, 3, 4]), name = 'novel.epub') {
  return new File([bytes], name, { type: 'application/epub+zip' });
}

async function callPost(
  fields: { language?: string; title?: string; file?: File | null },
  user: typeof USER | null = USER,
) {
  if (user) {
    requireUser.mockResolvedValueOnce(user);
  } else {
    requireUser.mockImplementationOnce(() => {
      throw { status: 401 };
    });
  }
  const fd = new FormData();
  if (fields.language !== undefined) fd.append('language', fields.language);
  if (fields.title !== undefined) fd.append('title', fields.title);
  if (fields.file) fd.append('file', fields.file);

  const { POST } = await import('./+server.js');
  const event = {
    params: {},
    request: new Request('http://x/api/v1/texts/epub', {
      method: 'POST',
      body: fd,
    }),
  } as unknown as Parameters<PostFn>[0];
  try {
    return await POST(event);
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  createChapterBookFromEpub.mockReset();
  requireUser.mockReset();
  consumeRateLimit.mockReset();
  consumeRateLimit.mockResolvedValue({
    limit: 10,
    remaining: 9,
    subjectType: 'user',
  });
});

afterEach(() => {
  vi.resetModules();
});

describe('POST /api/v1/texts/epub', () => {
  it('returns 201 with the new collection on a multi-chapter EPUB', async () => {
    createChapterBookFromEpub.mockResolvedValueOnce({
      kind: 'collection',
      collection: {
        id: 'col-1',
        ownerId: USER.id,
        language: 'hi',
        title: 'My novel',
        kind: 'chapter_book',
        visibility: 'private',
        createdAt: new Date('2026-04-27T00:00:00Z'),
      },
      texts: [
        { id: 'text-1' },
        { id: 'text-2' },
        { id: 'text-3' },
      ],
    });
    const res = (await callPost({
      language: 'hi',
      title: 'My novel',
      file: buildEpubFile(),
    })) as Response;
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.kind).toBe('collection');
    expect(json.collection.id).toBe('col-1');
    expect(json.collection.kind).toBe('chapter_book');
    expect(json.textCount).toBe(3);
    // First chapter id so a client can open the reader on chapter 1.
    expect(json.firstTextId).toBe('text-1');
  });

  it('returns 201 with a plain text on a single-chapter EPUB (fallback)', async () => {
    createChapterBookFromEpub.mockResolvedValueOnce({
      kind: 'text',
      text: {
        id: 'text-1',
        ownerId: USER.id,
        language: 'hi',
        title: 'Solo',
        sourceType: 'epub',
        status: 'pending',
        visibility: 'private',
        createdAt: new Date('2026-04-27T00:00:00Z'),
      },
      chapter: { id: 'c0' },
      chapters: [{ id: 'c0' }],
    });
    const res = (await callPost({
      language: 'hi',
      title: 'Solo',
      file: buildEpubFile(),
    })) as Response;
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.kind).toBe('text');
    expect(json.text.sourceType).toBe('epub');
    expect(json.chapterCount).toBe(1);
  });

  it('falls back to the filename when no title is supplied', async () => {
    createChapterBookFromEpub.mockResolvedValueOnce({
      kind: 'text',
      text: {
        id: 'text-1',
        ownerId: USER.id,
        language: 'hi',
        title: 'autotitled',
        sourceType: 'epub',
        status: 'pending',
        visibility: 'private',
        createdAt: new Date(),
      },
      chapter: { id: 'c0' },
      chapters: [{ id: 'c0' }],
    });
    await callPost({
      language: 'hi',
      file: buildEpubFile(undefined, 'A Hindi Novel.epub'),
    });
    expect(createChapterBookFromEpub).toHaveBeenCalledWith(
      { id: USER.id },
      expect.objectContaining({ title: 'A Hindi Novel' }),
    );
  });

  it('rejects an unsupported language with 400', async () => {
    const res = (await callPost({
      language: 'xx',
      title: 'X',
      file: buildEpubFile(),
    })) as { status: number };
    expect(res.status).toBe(400);
    expect(createChapterBookFromEpub).not.toHaveBeenCalled();
  });

  it('rejects a missing file with 400', async () => {
    const res = (await callPost({ language: 'hi', title: 'X' })) as {
      status: number;
    };
    expect(res.status).toBe(400);
  });

  it('rejects an empty file with 400', async () => {
    const res = (await callPost({
      language: 'hi',
      title: 'X',
      file: buildEpubFile(new Uint8Array(0)),
    })) as { status: number };
    expect(res.status).toBe(400);
  });

  it('maps EpubParseError to 400', async () => {
    const { EpubParseError } = await import('$lib/server/texts/upload.js');
    createChapterBookFromEpub.mockRejectedValueOnce(new EpubParseError('bad zip'));
    const res = (await callPost({
      language: 'hi',
      title: 'X',
      file: buildEpubFile(),
    })) as { status: number };
    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = (await callPost(
      { language: 'hi', title: 'X', file: buildEpubFile() },
      null,
    )) as { status: number };
    expect(res.status).toBe(401);
    expect(createChapterBookFromEpub).not.toHaveBeenCalled();
  });
});
