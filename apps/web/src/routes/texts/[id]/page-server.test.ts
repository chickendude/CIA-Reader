// @vitest-environment node
/**
 * Tests for /texts/[id] SSR loader (T-4.1, generalized in T-4.6).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getReadableText = vi.fn();

vi.mock('$lib/server/texts/upload.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/texts/upload.js')>(
    '$lib/server/texts/upload.js',
  );
  return {
    ...actual,
    getReadableText: (...a: unknown[]) => getReadableText(...a),
    getOwnedText: (...a: unknown[]) => getReadableText(...a),
  };
});

type LoadFn = (typeof import('./+page.server.js'))['load'];

const VALID_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = { id: 'user-1', role: 'user' as const };

async function callLoad(
  id: string,
  user: typeof USER | null = USER,
) {
  const { load } = await import('./+page.server.js');
  const event = {
    params: { id },
    locals: { user },
    url: new URL(`http://x/texts/${id}`),
  } as unknown as Parameters<LoadFn>[0];
  try {
    return await load(event);
  } catch (e) {
    return e as { status: number; location?: string };
  }
}

beforeEach(() => {
  getReadableText.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('/texts/[id] loader', () => {
  it('returns the text + chapters + isOwner=true for the owner', async () => {
    getReadableText.mockResolvedValueOnce({
      text: {
        id: VALID_ID,
        ownerId: USER.id,
        title: 'My text',
        language: 'hi',
        sourceType: 'paste',
        status: 'pending',
        statusError: null,
        visibility: 'private',
        createdAt: new Date('2026-04-27T00:00:00Z'),
      },
      chapters: [
        { id: 'c0', idx: 0, title: null, body: 'पाठ', tokenCount: 1 },
      ],
    });
    const data = (await callLoad(VALID_ID)) as {
      text: { id: string };
      isOwner: boolean;
    };
    expect(data.text.id).toBe(VALID_ID);
    expect(data.isOwner).toBe(true);
    expect(getReadableText).toHaveBeenCalledWith({ id: USER.id }, VALID_ID);
  });

  it('lets anonymous visitors read an official text and reports isOwner=false', async () => {
    getReadableText.mockResolvedValueOnce({
      text: {
        id: VALID_ID,
        ownerId: null,
        title: 'Curated short story',
        language: 'hi',
        sourceType: 'paste',
        status: 'ready',
        statusError: null,
        visibility: 'official',
        createdAt: new Date(),
      },
      chapters: [{ id: 'c0', idx: 0, title: null, body: 'x', tokenCount: 1 }],
    });
    const data = (await callLoad(VALID_ID, null)) as {
      text: { visibility: string };
      isOwner: boolean;
    };
    expect(data.text.visibility).toBe('official');
    expect(data.isOwner).toBe(false);
    // Anonymous viewer was passed as null to the helper.
    expect(getReadableText).toHaveBeenCalledWith(null, VALID_ID);
  });

  it('rejects an invalid uuid with 400 before calling the service', async () => {
    const res = (await callLoad('not-a-uuid')) as { status: number };
    expect(res.status).toBe(400);
    expect(getReadableText).not.toHaveBeenCalled();
  });

  it('returns 404 when the text is missing or unreadable', async () => {
    getReadableText.mockResolvedValueOnce(null);
    const res = (await callLoad(VALID_ID)) as { status: number };
    expect(res.status).toBe(404);
  });

  it('returns 404 when an anonymous viewer asks for a private text', async () => {
    getReadableText.mockResolvedValueOnce(null);
    const res = (await callLoad(VALID_ID, null)) as { status: number };
    expect(res.status).toBe(404);
  });
});
