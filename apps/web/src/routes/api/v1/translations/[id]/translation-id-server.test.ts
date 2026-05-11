// @vitest-environment node
/**
 * Route tests for PATCH + DELETE /api/v1/translations/:id (T-3.5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updateUserTranslation = vi.fn();
const deleteUserTranslation = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/dictionary/translations.js', async () => {
  const actual = await vi.importActual<
    typeof import('$lib/server/dictionary/translations.js')
  >('$lib/server/dictionary/translations.js');
  return {
    ...actual,
    updateUserTranslation: (...a: unknown[]) => updateUserTranslation(...a),
    deleteUserTranslation: (...a: unknown[]) => deleteUserTranslation(...a),
  };
});

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
  requireVerifiedUser: (...a: unknown[]) => requireUser(...a),
}));

type PatchFn = (typeof import('./+server.js'))['PATCH'];
type DeleteFn = (typeof import('./+server.js'))['DELETE'];
type PatchEvent = Parameters<PatchFn>[0];
type DeleteEvent = Parameters<DeleteFn>[0];

const VALID_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

async function callPatch(
  body: unknown,
  user: { id: string } | null = { id: 'user-1' },
  id = VALID_ID,
) {
  if (user) {
    requireUser.mockResolvedValueOnce(user);
  } else {
    requireUser.mockImplementationOnce(() => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 });
    });
  }
  const { PATCH } = await import('./+server.js');
  const event = {
    params: { id },
    request: new Request(`http://x/api/v1/translations/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as PatchEvent;
  try {
    return await PATCH(event);
  } catch (e) {
    return e as { status: number };
  }
}

async function callDelete(
  user: { id: string } | null = { id: 'user-1' },
  id = VALID_ID,
) {
  if (user) {
    requireUser.mockResolvedValueOnce(user);
  } else {
    requireUser.mockImplementationOnce(() => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 });
    });
  }
  const { DELETE } = await import('./+server.js');
  const event = {
    params: { id },
    request: new Request(`http://x/api/v1/translations/${id}`, {
      method: 'DELETE',
    }),
  } as unknown as DeleteEvent;
  try {
    return await DELETE(event);
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  updateUserTranslation.mockReset();
  deleteUserTranslation.mockReset();
  requireUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('PATCH /api/v1/translations/:id', () => {
  it('returns 200 with the public translation on success', async () => {
    updateUserTranslation.mockResolvedValueOnce({
      id: VALID_ID,
      lemmaId: 'lemma-1',
      source: 'user',
      submittedBy: 'user-1',
      parentTranslationId: null,
      body: 'new gloss',
      targetLanguage: 'en',
      sourceAttribution: null,
      sourceId: null,
      hidden: false,
      createdAt: new Date('2026-04-24'),
      updatedAt: new Date('2026-04-24'),
    });
    const res = (await callPatch({ body: 'new gloss' })) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.translation.body).toBe('new gloss');
    expect(updateUserTranslation).toHaveBeenCalledWith('user-1', VALID_ID, {
      body: 'new gloss',
    });
  });

  it('returns 401 when not logged in', async () => {
    const res = (await callPatch({ body: 'x' }, null)) as { status: number };
    expect(res.status).toBe(401);
    expect(updateUserTranslation).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed UUID', async () => {
    const res = (await callPatch(
      { body: 'x' },
      { id: 'user-1' },
      'not-a-uuid',
    )) as { status: number };
    expect(res.status).toBe(400);
    expect(updateUserTranslation).not.toHaveBeenCalled();
  });

  it('returns 400 when the body is missing from the request', async () => {
    const res = (await callPatch({})) as { status: number };
    expect(res.status).toBe(400);
    expect(updateUserTranslation).not.toHaveBeenCalled();
  });

  it('maps TranslationValidationError(403) to a 403 response', async () => {
    const { TranslationValidationError } = await import(
      '$lib/server/dictionary/translations.js'
    );
    updateUserTranslation.mockRejectedValueOnce(
      new TranslationValidationError('You can only edit your own translations', 403),
    );
    const res = (await callPatch({ body: 'x' })) as { status: number };
    expect(res.status).toBe(403);
  });

  it('maps TranslationValidationError(404) to a 404 response', async () => {
    const { TranslationValidationError } = await import(
      '$lib/server/dictionary/translations.js'
    );
    updateUserTranslation.mockRejectedValueOnce(
      new TranslationValidationError('not found', 404),
    );
    const res = (await callPatch({ body: 'x' })) as { status: number };
    expect(res.status).toBe(404);
  });

  it('maps validation failures (empty body) to 400', async () => {
    const { TranslationValidationError } = await import(
      '$lib/server/dictionary/translations.js'
    );
    updateUserTranslation.mockRejectedValueOnce(
      new TranslationValidationError('Translation body cannot be empty'),
    );
    const res = (await callPatch({ body: '' })) as { status: number };
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/v1/translations/:id', () => {
  it('returns 204 on successful delete', async () => {
    deleteUserTranslation.mockResolvedValueOnce(undefined);
    const res = (await callDelete()) as Response;
    expect(res.status).toBe(204);
    expect(deleteUserTranslation).toHaveBeenCalledWith('user-1', VALID_ID);
  });

  it('returns 401 when not logged in', async () => {
    const res = (await callDelete(null)) as { status: number };
    expect(res.status).toBe(401);
    expect(deleteUserTranslation).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed UUID', async () => {
    const res = (await callDelete({ id: 'user-1' }, 'nope')) as {
      status: number;
    };
    expect(res.status).toBe(400);
    expect(deleteUserTranslation).not.toHaveBeenCalled();
  });

  it('maps TranslationValidationError(403) to a 403 response', async () => {
    const { TranslationValidationError } = await import(
      '$lib/server/dictionary/translations.js'
    );
    deleteUserTranslation.mockRejectedValueOnce(
      new TranslationValidationError('not yours', 403),
    );
    const res = (await callDelete()) as { status: number };
    expect(res.status).toBe(403);
  });

  it('maps TranslationValidationError(404) to a 404 response', async () => {
    const { TranslationValidationError } = await import(
      '$lib/server/dictionary/translations.js'
    );
    deleteUserTranslation.mockRejectedValueOnce(
      new TranslationValidationError('not found', 404),
    );
    const res = (await callDelete()) as { status: number };
    expect(res.status).toBe(404);
  });
});
