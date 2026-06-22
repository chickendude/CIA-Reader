// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const setTextProgress = vi.fn();
const getTextProgress = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/texts/progress.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/texts/progress.js')>(
    '$lib/server/texts/progress.js',
  );
  return {
    ...actual,
    setTextProgress: (...a: unknown[]) => setTextProgress(...a),
    getTextProgress: (...a: unknown[]) => getTextProgress(...a),
  };
});

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

type PatchFn = (typeof import('./+server.js'))['PATCH'];

const VALID_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = { id: 'user-1', role: 'user' as const };

async function callPatch(
  body: unknown,
  textId = VALID_ID,
  user: typeof USER | null = USER,
) {
  if (user) {
    requireUser.mockResolvedValueOnce(user);
  } else {
    requireUser.mockImplementationOnce(() => {
      throw { status: 401 };
    });
  }
  const { PATCH } = await import('./+server.js');
  const event = {
    params: { textId },
    request: new Request(`http://x/api/v1/me/text-progress/${textId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as Parameters<PatchFn>[0];
  try {
    return await PATCH(event);
  } catch (e) {
    return e as { status: number };
  }
}

type GetFn = (typeof import('./+server.js'))['GET'];

async function callGet(textId = VALID_ID, user: typeof USER | null = USER) {
  if (user) {
    requireUser.mockResolvedValueOnce(user);
  } else {
    requireUser.mockImplementationOnce(() => {
      throw { status: 401 };
    });
  }
  const { GET } = await import('./+server.js');
  const event = {
    params: { textId },
    request: new Request(`http://x/api/v1/me/text-progress/${textId}`),
  } as unknown as Parameters<GetFn>[0];
  try {
    return await GET(event);
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  setTextProgress.mockReset();
  getTextProgress.mockReset();
  requireUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('PATCH /api/v1/me/text-progress/:textId', () => {
  it('persists the anchor and returns the progress row', async () => {
    setTextProgress.mockResolvedValueOnce({
      userId: USER.id,
      textId: VALID_ID,
      lastChapterIdx: 3,
      lastTokenIdx: 50,
      pctRead: 25,
      updatedAt: new Date('2026-04-27T00:00:00Z'),
    });
    const res = (await callPatch({
      chapterIdx: 3,
      tokenIdx: 50,
      pctRead: 25,
    })) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.progress.lastChapterIdx).toBe(3);
    expect(setTextProgress).toHaveBeenCalledWith({
      userId: USER.id,
      textId: VALID_ID,
      lastChapterIdx: 3,
      lastTokenIdx: 50,
      pctRead: 25,
    });
  });

  it('rejects a negative chapterIdx with 400', async () => {
    const res = (await callPatch({ chapterIdx: -1 })) as { status: number };
    expect(res.status).toBe(400);
  });

  it('rejects pctRead > 100 with 400', async () => {
    const res = (await callPatch({ chapterIdx: 0, pctRead: 200 })) as {
      status: number;
    };
    expect(res.status).toBe(400);
  });

  it('rejects an invalid uuid with 400', async () => {
    const res = (await callPatch({ chapterIdx: 0 }, 'not-a-uuid')) as {
      status: number;
    };
    expect(res.status).toBe(400);
  });

  it('returns 404 when the viewer cannot read the text', async () => {
    const { ProgressNotAccessibleError } = await import(
      '$lib/server/texts/progress.js'
    );
    setTextProgress.mockRejectedValueOnce(new ProgressNotAccessibleError());
    const res = (await callPatch({ chapterIdx: 0 })) as { status: number };
    expect(res.status).toBe(404);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = (await callPatch({ chapterIdx: 0 }, VALID_ID, null)) as {
      status: number;
    };
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/me/text-progress/:textId', () => {
  it('returns the saved progress row', async () => {
    getTextProgress.mockResolvedValueOnce({
      userId: USER.id,
      textId: VALID_ID,
      lastChapterIdx: 2,
      lastTokenIdx: 40,
      pctRead: 15,
      updatedAt: new Date('2026-04-27T00:00:00Z'),
    });
    const res = (await callGet()) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.progress.lastChapterIdx).toBe(2);
    expect(json.progress.lastTokenIdx).toBe(40);
    expect(getTextProgress).toHaveBeenCalledWith(USER.id, VALID_ID);
  });

  it('returns null when there is no saved progress', async () => {
    getTextProgress.mockResolvedValueOnce(null);
    const res = (await callGet()) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.progress).toBeNull();
  });

  it('rejects an invalid uuid with 400', async () => {
    const res = (await callGet('not-a-uuid')) as { status: number };
    expect(res.status).toBe(400);
    expect(getTextProgress).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    const res = (await callGet(VALID_ID, null)) as { status: number };
    expect(res.status).toBe(401);
  });
});
