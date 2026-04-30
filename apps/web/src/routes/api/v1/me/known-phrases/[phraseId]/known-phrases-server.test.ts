// @vitest-environment node
/**
 * Endpoint tests for PATCH /api/v1/me/known-phrases/:phraseId
 * (T-14.1). Mirrors the structure of `known-lemmas-server.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const setKnownPhraseStatus = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/phrases.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/phrases.js')>(
    '$lib/server/phrases.js',
  );
  return {
    ...actual,
    setKnownPhraseStatus: (...a: unknown[]) => setKnownPhraseStatus(...a),
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
  phraseId = VALID_ID,
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
    params: { phraseId },
    request: new Request(`http://x/api/v1/me/known-phrases/${phraseId}`, {
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
  setKnownPhraseStatus.mockReset();
  requireUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('PATCH /api/v1/me/known-phrases/:phraseId', () => {
  it('updates the status and returns the row', async () => {
    setKnownPhraseStatus.mockResolvedValueOnce({
      userId: USER.id,
      phraseId: VALID_ID,
      status: 'known',
      updatedAt: new Date('2026-04-30T00:00:00Z'),
    });
    const res = (await callPatch({ status: 'known' })) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.knownPhrase.status).toBe('known');
    expect(json.knownPhrase.phraseId).toBe(VALID_ID);
    expect(setKnownPhraseStatus).toHaveBeenCalledWith({
      userId: USER.id,
      phraseId: VALID_ID,
      status: 'known',
    });
  });

  it('rejects an invalid status', async () => {
    const res = (await callPatch({ status: 'bogus' })) as { status: number };
    expect(res.status).toBe(400);
    expect(setKnownPhraseStatus).not.toHaveBeenCalled();
  });

  it('rejects an invalid phrase id format', async () => {
    const res = (await callPatch({ status: 'known' }, 'not-a-uuid')) as {
      status: number;
    };
    expect(res.status).toBe(400);
    expect(setKnownPhraseStatus).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON', async () => {
    const res = (await callPatch('{ broken json')) as { status: number };
    expect(res.status).toBe(400);
    expect(setKnownPhraseStatus).not.toHaveBeenCalled();
  });

  it('returns 401 when no user is authenticated', async () => {
    const res = (await callPatch({ status: 'known' }, VALID_ID, null)) as {
      status: number;
    };
    expect(res.status).toBe(401);
    expect(setKnownPhraseStatus).not.toHaveBeenCalled();
  });

  it('translates a 404 from the service into a 404 response', async () => {
    const { PhraseValidationError } = await import('$lib/server/phrases.js');
    setKnownPhraseStatus.mockRejectedValueOnce(
      new PhraseValidationError('Phrase missing not found', 404),
    );
    const res = (await callPatch({ status: 'known' })) as { status: number };
    expect(res.status).toBe(404);
  });
});
