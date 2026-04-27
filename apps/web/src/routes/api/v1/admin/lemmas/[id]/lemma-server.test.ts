// @vitest-environment node
/**
 * Route tests for GET + PATCH /api/v1/admin/lemmas/:id (T-3.7).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getLemmaEditorView = vi.fn();
const updateLemma = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/dictionary/curator.js', async () => {
  const actual = await vi.importActual<
    typeof import('$lib/server/dictionary/curator.js')
  >('$lib/server/dictionary/curator.js');
  return {
    ...actual,
    getLemmaEditorView: (...a: unknown[]) => getLemmaEditorView(...a),
    updateLemma: (...a: unknown[]) => updateLemma(...a),
  };
});

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

type GetFn = (typeof import('./+server.js'))['GET'];
type PatchFn = (typeof import('./+server.js'))['PATCH'];

const VALID_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ADMIN = { id: 'admin-1', role: 'admin' as const };

async function callGet(user = ADMIN, id = VALID_ID) {
  requireUser.mockResolvedValueOnce(user);
  const { GET } = await import('./+server.js');
  const event = {
    params: { id },
    request: new Request(`http://x/api/v1/admin/lemmas/${id}`),
  } as unknown as Parameters<GetFn>[0];
  try {
    return await GET(event);
  } catch (e) {
    return e as { status: number };
  }
}

async function callPatch(body: unknown, user = ADMIN, id = VALID_ID) {
  requireUser.mockResolvedValueOnce(user);
  const { PATCH } = await import('./+server.js');
  const event = {
    params: { id },
    request: new Request(`http://x/api/v1/admin/lemmas/${id}`, {
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

beforeEach(() => {
  getLemmaEditorView.mockReset();
  updateLemma.mockReset();
  requireUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('GET /api/v1/admin/lemmas/:id', () => {
  it('returns the editor view on success', async () => {
    getLemmaEditorView.mockResolvedValueOnce({
      lemma: { id: VALID_ID, language: 'hi' },
      translations: [],
      forms: [],
      history: [],
    });
    const res = (await callGet()) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.lemma.id).toBe(VALID_ID);
  });

  it('returns 400 on malformed id', async () => {
    const res = (await callGet(ADMIN, 'not-a-uuid')) as { status: number };
    expect(res.status).toBe(400);
    expect(getLemmaEditorView).not.toHaveBeenCalled();
  });

  it('maps ForbiddenError to 403', async () => {
    const { ForbiddenError } = await import(
      '$lib/server/dictionary/permissions.js'
    );
    getLemmaEditorView.mockRejectedValueOnce(new ForbiddenError('no grant'));
    const res = (await callGet()) as { status: number };
    expect(res.status).toBe(403);
  });

  it('maps CuratorValidationError(404) to 404', async () => {
    const { CuratorValidationError } = await import(
      '$lib/server/dictionary/curator.js'
    );
    getLemmaEditorView.mockRejectedValueOnce(
      new CuratorValidationError('not found', 404),
    );
    const res = (await callGet()) as { status: number };
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/v1/admin/lemmas/:id', () => {
  it('updates the lemma and returns 200', async () => {
    updateLemma.mockResolvedValueOnce({
      id: VALID_ID,
      language: 'hi',
      headword: 'बोलना',
      glossDefault: 'to speak',
    });
    const res = (await callPatch({
      glossDefault: 'to speak',
      reason: 'Clarify gloss',
    })) as Response;
    expect(res.status).toBe(200);
    expect(updateLemma).toHaveBeenCalledWith(
      ADMIN,
      VALID_ID,
      { glossDefault: 'to speak' },
      'Clarify gloss',
    );
  });

  it('returns 400 when reason is missing from the body', async () => {
    const res = (await callPatch({ glossDefault: 'x' })) as { status: number };
    expect(res.status).toBe(400);
    expect(updateLemma).not.toHaveBeenCalled();
  });

  it('maps MissingReasonError to 400', async () => {
    const { MissingReasonError } = await import(
      '$lib/server/dictionary/audit.js'
    );
    updateLemma.mockRejectedValueOnce(new MissingReasonError());
    const res = (await callPatch({
      glossDefault: 'x',
      reason: 'ok',
    })) as { status: number };
    expect(res.status).toBe(400);
  });

  it('maps CuratorValidationError(409) to 409', async () => {
    const { CuratorValidationError } = await import(
      '$lib/server/dictionary/curator.js'
    );
    updateLemma.mockRejectedValueOnce(
      new CuratorValidationError('conflict', 409),
    );
    const res = (await callPatch({
      glossDefault: 'x',
      reason: 'ok now',
    })) as { status: number };
    expect(res.status).toBe(409);
  });
});
