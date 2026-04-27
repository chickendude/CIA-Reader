// @vitest-environment node
/**
 * Route tests for POST /api/v1/texts (T-4.1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createPastedText = vi.fn();
const createTxtText = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/texts/upload.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/texts/upload.js')>(
    '$lib/server/texts/upload.js',
  );
  return {
    ...actual,
    createPastedText: (...a: unknown[]) => createPastedText(...a),
    createTxtText: (...a: unknown[]) => createTxtText(...a),
  };
});

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

type PostFn = (typeof import('./+server.js'))['POST'];

const USER = { id: 'user-1', role: 'user' as const };

async function callPost(body: unknown, user: typeof USER | null = USER) {
  if (user) {
    requireUser.mockResolvedValueOnce(user);
  } else {
    // Simulate the require-user 401 path.
    requireUser.mockImplementationOnce(() => {
      throw { status: 401, body: { message: 'Unauthorized' } };
    });
  }
  const { POST } = await import('./+server.js');
  const event = {
    params: {},
    request: new Request('http://x/api/v1/texts', {
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
  createPastedText.mockReset();
  createTxtText.mockReset();
  requireUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('POST /api/v1/texts', () => {
  it('returns 201 with the new text on the paste path', async () => {
    createPastedText.mockResolvedValueOnce({
      text: {
        id: 'text-1',
        ownerId: USER.id,
        language: 'hi',
        title: 'My text',
        sourceType: 'paste',
        status: 'pending',
        visibility: 'private',
        createdAt: new Date('2026-04-27T00:00:00Z'),
      },
      chapter: { id: 'chap-1' },
      chapters: [{ id: 'chap-1' }],
    });
    const res = (await callPost({
      language: 'hi',
      title: 'My text',
      body: 'पाठ का मूल पाठ।',
    })) as Response;
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.text).toMatchObject({
      id: 'text-1',
      status: 'pending',
      visibility: 'private',
      sourceType: 'paste',
    });
    expect(json.chapterCount).toBe(1);
    expect(createPastedText).toHaveBeenCalledWith(
      { id: USER.id },
      { language: 'hi', title: 'My text', body: 'पाठ का मूल पाठ।' },
    );
    expect(createTxtText).not.toHaveBeenCalled();
  });

  it('routes sourceType=txt through createTxtText and reports chapterCount', async () => {
    createTxtText.mockResolvedValueOnce({
      text: {
        id: 'text-2',
        ownerId: USER.id,
        language: 'hi',
        title: 'Big book',
        sourceType: 'txt',
        status: 'pending',
        visibility: 'private',
        createdAt: new Date('2026-04-27T00:00:00Z'),
      },
      chapter: { id: 'c0' },
      chapters: [{ id: 'c0' }, { id: 'c1' }, { id: 'c2' }],
    });
    const res = (await callPost({
      sourceType: 'txt',
      language: 'hi',
      title: 'Big book',
      body: 'first.\n---\nsecond.\n---\nthird.',
    })) as Response;
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.text.sourceType).toBe('txt');
    expect(json.chapterCount).toBe(3);
    expect(createTxtText).toHaveBeenCalledTimes(1);
    expect(createPastedText).not.toHaveBeenCalled();
  });

  it('rejects an unsupported language with 400 before calling the service', async () => {
    const res = (await callPost({
      language: 'xx',
      title: 'X',
      body: 'hello',
    })) as { status: number };
    expect(res.status).toBe(400);
    expect(createPastedText).not.toHaveBeenCalled();
  });

  it('rejects an empty title with 400', async () => {
    const res = (await callPost({
      language: 'hi',
      title: '',
      body: 'hello',
    })) as { status: number };
    expect(res.status).toBe(400);
  });

  it('rejects an empty body with 400', async () => {
    const res = (await callPost({
      language: 'hi',
      title: 'X',
      body: '',
    })) as { status: number };
    expect(res.status).toBe(400);
  });

  it('maps TextValidationError(400) to 400', async () => {
    const { TextValidationError } = await import(
      '$lib/server/texts/upload.js'
    );
    createPastedText.mockRejectedValueOnce(
      new TextValidationError('body cannot be empty'),
    );
    const res = (await callPost({
      language: 'hi',
      title: 'X',
      body: 'hello',
    })) as { status: number };
    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = (await callPost(
      { language: 'hi', title: 'X', body: 'hello' },
      null,
    )) as { status: number };
    expect(res.status).toBe(401);
    expect(createPastedText).not.toHaveBeenCalled();
  });
});
