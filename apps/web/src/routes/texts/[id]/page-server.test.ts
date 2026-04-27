// @vitest-environment node
/**
 * Tests for /texts/[id] SSR loader (T-4.1).
 *
 * Placeholder viewer — at T-4.1 it's owner-only; T-4.6 swaps in the
 * full assertCanRead helper.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getOwnedText = vi.fn();

vi.mock('$lib/server/texts/upload.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/texts/upload.js')>(
    '$lib/server/texts/upload.js',
  );
  return {
    ...actual,
    getOwnedText: (...a: unknown[]) => getOwnedText(...a),
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
  getOwnedText.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('/texts/[id] loader', () => {
  it('returns the text + chapters on a happy path', async () => {
    getOwnedText.mockResolvedValueOnce({
      text: {
        id: VALID_ID,
        title: 'My text',
        language: 'hi',
        sourceType: 'paste',
        status: 'pending',
        visibility: 'private',
        createdAt: new Date('2026-04-27T00:00:00Z'),
      },
      chapters: [
        { id: 'c0', idx: 0, title: null, body: 'पाठ', tokenCount: 1 },
      ],
    });
    const data = (await callLoad(VALID_ID)) as {
      text: { id: string; status: string };
      chapters: Array<{ id: string }>;
    };
    expect(data.text.id).toBe(VALID_ID);
    expect(data.text.status).toBe('pending');
    expect(data.chapters).toHaveLength(1);
    expect(getOwnedText).toHaveBeenCalledWith({ id: USER.id }, VALID_ID);
  });

  it('redirects unauthenticated visitors to /login', async () => {
    const res = (await callLoad(VALID_ID, null)) as {
      status: number;
      location: string;
    };
    expect(res.status).toBe(303);
    expect(res.location).toContain('/login');
    expect(getOwnedText).not.toHaveBeenCalled();
  });

  it('rejects an invalid uuid with 400', async () => {
    const res = (await callLoad('not-a-uuid')) as { status: number };
    expect(res.status).toBe(400);
    expect(getOwnedText).not.toHaveBeenCalled();
  });

  it('returns 404 when the text does not exist or is not owned', async () => {
    getOwnedText.mockResolvedValueOnce(null);
    const res = (await callLoad(VALID_ID)) as { status: number };
    expect(res.status).toBe(404);
  });
});
