// @vitest-environment node
/**
 * Route tests for POST /api/v1/admin/phrases/merge (T-14.7).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mergePhrases = vi.fn();
const requireUser = vi.fn();
const requireCanEditDictionary = vi.fn();

vi.mock('$lib/server/phrases.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/phrases.js')>(
    '$lib/server/phrases.js',
  );
  return {
    ...actual,
    mergePhrases: (...a: unknown[]) => mergePhrases(...a),
  };
});

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

vi.mock('$lib/server/dictionary/permissions.js', async () => {
  const actual = await vi.importActual<
    typeof import('$lib/server/dictionary/permissions.js')
  >('$lib/server/dictionary/permissions.js');
  return {
    ...actual,
    requireCanEditDictionary: (...a: unknown[]) => requireCanEditDictionary(...a),
  };
});

// Mock the DB chain used by the endpoint to look up the phrase's
// language for the permission check.
let phraseLookupRows: Array<{ language: string }> = [];
vi.mock('$lib/server/db/index.js', () => {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => phraseLookupRows),
  };
  return {
    db: { select: vi.fn(() => chain) },
    schema: {
      phrases: {
        id: 'phrases.id',
        language: 'phrases.language',
      },
    },
  };
});

type Post = (typeof import('./+server.js'))['POST'];

const KEEP_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DROP_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ADMIN = { id: 'admin-1', role: 'admin' as const };

async function callPost(body: unknown, user: typeof ADMIN | null = ADMIN) {
  if (user) {
    requireUser.mockResolvedValueOnce(user);
  } else {
    requireUser.mockImplementationOnce(() => {
      throw { status: 401 };
    });
  }
  const { POST } = await import('./+server.js');
  const event = {
    params: {},
    request: new Request('http://x/api/v1/admin/phrases/merge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as Parameters<Post>[0];
  try {
    return await POST(event);
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  mergePhrases.mockReset();
  requireUser.mockReset();
  requireCanEditDictionary.mockReset();
  requireCanEditDictionary.mockResolvedValue(undefined);
  phraseLookupRows = [{ language: 'hi' }];
});

afterEach(() => {
  vi.resetModules();
});

describe('POST /api/v1/admin/phrases/merge', () => {
  it('merges two phrases and returns the moved counts on success', async () => {
    mergePhrases.mockResolvedValueOnce({
      keptPhrase: { id: KEEP_ID },
      droppedPhrase: { id: DROP_ID },
      moved: { translations: 2, spans: 1, knownPhraseRows: 3 },
    });
    const res = (await callPost({
      keepId: KEEP_ID,
      dropId: DROP_ID,
      reason: 'duplicate user submission',
    })) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.keptPhrase.id).toBe(KEEP_ID);
    expect(json.droppedPhraseId).toBe(DROP_ID);
    expect(json.moved.translations).toBe(2);
    expect(mergePhrases).toHaveBeenCalledWith({
      keepId: KEEP_ID,
      dropId: DROP_ID,
      performedBy: ADMIN.id,
      reason: 'duplicate user submission',
    });
  });

  it('returns 403 when the user lacks edit rights for the language', async () => {
    const { ForbiddenError } = await import(
      '$lib/server/dictionary/permissions.js'
    );
    requireCanEditDictionary.mockRejectedValueOnce(
      new ForbiddenError('No curator grant for hi'),
    );
    const res = (await callPost({
      keepId: KEEP_ID,
      dropId: DROP_ID,
      reason: 'duplicate user submission',
    })) as { status: number };
    expect(res.status).toBe(403);
    expect(mergePhrases).not.toHaveBeenCalled();
  });

  it('returns 404 when the keep phrase does not exist', async () => {
    phraseLookupRows = [];
    const res = (await callPost({
      keepId: KEEP_ID,
      dropId: DROP_ID,
      reason: 'gone',
    })) as { status: number };
    expect(res.status).toBe(404);
  });

  it('returns 409 when the service throws PhraseMergeMismatchError', async () => {
    const { PhraseMergeMismatchError } = await import(
      '$lib/server/phrases.js'
    );
    mergePhrases.mockRejectedValueOnce(
      new PhraseMergeMismatchError('Cannot merge across languages'),
    );
    const res = (await callPost({
      keepId: KEEP_ID,
      dropId: DROP_ID,
      reason: 'cross-lang attempt',
    })) as { status: number };
    expect(res.status).toBe(409);
  });

  it('rejects bodies that fail validation (missing reason)', async () => {
    const res = (await callPost({
      keepId: KEEP_ID,
      dropId: DROP_ID,
    })) as { status: number };
    expect(res.status).toBe(400);
    expect(mergePhrases).not.toHaveBeenCalled();
  });

  it('returns 401 when the caller is not authenticated', async () => {
    const res = (await callPost(
      { keepId: KEEP_ID, dropId: DROP_ID, reason: 'x' },
      null,
    )) as { status: number };
    expect(res.status).toBe(401);
  });
});
