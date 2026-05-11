// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requireUser = vi.fn();
const setTranslationVote = vi.fn();

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
  requireVerifiedUser: (...a: unknown[]) => requireUser(...a),
}));

vi.mock('$lib/server/dictionary/votes.js', () => {
  class TranslationVoteError extends Error {
    constructor(
      message: string,
      public readonly status: number,
    ) {
      super(message);
    }
  }
  return {
    TranslationVoteError,
    setTranslationVote: (...a: unknown[]) => setTranslationVote(...a),
  };
});

type PatchFn = (typeof import('./+server.js'))['PATCH'];
const ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

async function callPatch(id = ID, body: unknown = { vote: 'up' }) {
  const { PATCH } = await import('./+server.js');
  const event = {
    params: { id },
    request: new Request(`http://x/api/v1/translations/${id}/vote`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as Parameters<PatchFn>[0];
  try {
    return (await PATCH(event)) as Response;
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  requireUser.mockReset();
  requireUser.mockResolvedValue({ id: 'u1' });
  setTranslationVote.mockReset();
  setTranslationVote.mockResolvedValue({
    translationId: ID,
    vote: 'up',
    score: 1,
  });
});

afterEach(() => {
  vi.resetModules();
});

describe('PATCH /api/v1/translations/:id/vote', () => {
  it('writes a vote and returns the summary', async () => {
    const res = (await callPatch()) as Response;
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      vote: { translationId: ID, vote: 'up', score: 1 },
    });
    expect(setTranslationVote).toHaveBeenCalledWith('u1', ID, 'up');
  });

  it('accepts null to clear the vote', async () => {
    const res = (await callPatch(ID, { vote: null })) as Response;
    expect(res.status).toBe(200);
    expect(setTranslationVote).toHaveBeenCalledWith('u1', ID, null);
  });

  it('rejects malformed ids', async () => {
    const res = (await callPatch('bad-id')) as { status: number };
    expect(res.status).toBe(400);
    expect(setTranslationVote).not.toHaveBeenCalled();
  });

  it('rejects malformed bodies', async () => {
    const res = (await callPatch(ID, { vote: 'sideways' })) as {
      status: number;
    };
    expect(res.status).toBe(400);
    expect(setTranslationVote).not.toHaveBeenCalled();
  });
});
