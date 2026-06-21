// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonContract } from '$lib/test/json-contract.js';

const setKnownLemmaStatus = vi.fn();
const requireUser = vi.fn();
const sentenceAround = vi.fn();

vi.mock('$lib/server/texts/tokens.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/texts/tokens.js')>(
    '$lib/server/texts/tokens.js',
  );
  return {
    ...actual,
    setKnownLemmaStatus: (...a: unknown[]) => setKnownLemmaStatus(...a),
  };
});

vi.mock('$lib/server/texts/sentences.js', () => ({
  sentenceAround: (...a: unknown[]) => sentenceAround(...a),
}));

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

type PatchFn = (typeof import('./+server.js'))['PATCH'];

const VALID_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = { id: 'user-1', role: 'user' as const };

async function callPatch(
  body: unknown,
  lemmaId = VALID_ID,
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
    params: { lemmaId },
    request: new Request(`http://x/api/v1/me/known-lemmas/${lemmaId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as unknown as Parameters<PatchFn>[0];
  try {
    return await PATCH(event);
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  setKnownLemmaStatus.mockReset();
  requireUser.mockReset();
  sentenceAround.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('PATCH /api/v1/me/known-lemmas/:lemmaId', () => {
  it('updates the status and returns the row', async () => {
    setKnownLemmaStatus.mockResolvedValueOnce({
      userId: USER.id,
      lemmaId: VALID_ID,
      status: 'known',
      updatedAt: new Date('2026-04-27T00:00:00Z'),
    });
    const res = (await callPatch({ status: 'known' })) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.knownLemma.status).toBe('known');
    expect(jsonContract(json)).toMatchInlineSnapshot(`
      {
        "knownLemma": {
          "lemmaId": "string",
          "status": "string",
          "updatedAt": "string",
          "userId": "string",
        },
      }
    `);
    expect(setKnownLemmaStatus).toHaveBeenCalledWith({
      userId: USER.id,
      lemmaId: VALID_ID,
      status: 'known',
    });
  });

  it('rejects an unsupported status with 400', async () => {
    const res = (await callPatch({ status: 'maybe' })) as { status: number };
    expect(res.status).toBe(400);
    expect(setKnownLemmaStatus).not.toHaveBeenCalled();
  });

  it('rejects a missing body with 400', async () => {
    const res = (await callPatch({})) as { status: number };
    expect(res.status).toBe(400);
  });

  it('rejects an invalid lemma uuid with 400', async () => {
    const res = (await callPatch({ status: 'known' }, 'not-a-uuid')) as {
      status: number;
    };
    expect(res.status).toBe(400);
  });

  it('returns 404 when the service reports the lemma is missing', async () => {
    setKnownLemmaStatus.mockRejectedValueOnce(
      new Error('Lemma abc not found'),
    );
    const res = (await callPatch({ status: 'known' })) as { status: number };
    expect(res.status).toBe(404);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = (await callPatch({ status: 'known' }, VALID_ID, null)) as {
      status: number;
    };
    expect(res.status).toBe(401);
    expect(setKnownLemmaStatus).not.toHaveBeenCalled();
  });

  it('captures the mined sentence when reading context is supplied', async () => {
    setKnownLemmaStatus.mockResolvedValueOnce({
      userId: USER.id,
      lemmaId: VALID_ID,
      status: 'learning',
      updatedAt: new Date('2026-04-27T00:00:00Z'),
    });
    sentenceAround.mockResolvedValueOnce('Portuetxe kalea, 88 bis.');
    const res = (await callPatch({
      status: 'learning',
      chapterId: VALID_ID,
      tokenIdx: 5,
    })) as Response;
    expect(res.status).toBe(200);
    expect(sentenceAround).toHaveBeenCalledWith(VALID_ID, 5);
    expect(setKnownLemmaStatus).toHaveBeenCalledWith({
      userId: USER.id,
      lemmaId: VALID_ID,
      status: 'learning',
      minedSentence: 'Portuetxe kalea, 88 bis.',
      minedChapterId: VALID_ID,
      minedTokenIdx: 5,
    });
  });

  it('skips context capture when the reconstructed sentence is empty', async () => {
    setKnownLemmaStatus.mockResolvedValueOnce({
      userId: USER.id,
      lemmaId: VALID_ID,
      status: 'learning',
      updatedAt: new Date('2026-04-27T00:00:00Z'),
    });
    sentenceAround.mockResolvedValueOnce('');
    await callPatch({ status: 'learning', chapterId: VALID_ID, tokenIdx: 5 });
    expect(setKnownLemmaStatus).toHaveBeenCalledWith({
      userId: USER.id,
      lemmaId: VALID_ID,
      status: 'learning',
    });
  });
});
