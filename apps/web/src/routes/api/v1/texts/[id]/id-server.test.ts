// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deleteText = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/texts/upload.js', async () => {
  const actual = await vi.importActual<
    typeof import('$lib/server/texts/upload.js')
  >('$lib/server/texts/upload.js');
  return {
    ...actual,
    deleteText: (...a: unknown[]) => deleteText(...a),
  };
});

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
  requireVerifiedUser: (...a: unknown[]) => requireUser(...a),
}));

type DeleteFn = (typeof import('./+server.js'))['DELETE'];

const USER = { id: 'user-1', role: 'user' as const };
const VALID_ID = '11111111-1111-1111-1111-111111111111';

async function callDelete(
  id: string = VALID_ID,
  user: typeof USER | null = USER,
) {
  if (user) {
    requireUser.mockResolvedValueOnce(user);
  } else {
    requireUser.mockImplementationOnce(() => {
      throw { status: 401 };
    });
  }
  const { DELETE } = await import('./+server.js');
  const event = {
    params: { id },
    request: new Request(`http://x/api/v1/texts/${id}`, { method: 'DELETE' }),
  } as unknown as Parameters<DeleteFn>[0];
  try {
    return await DELETE(event);
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  deleteText.mockReset();
  requireUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('DELETE /api/v1/texts/:id', () => {
  it('returns 200 ok on a happy-path delete', async () => {
    deleteText.mockResolvedValueOnce(undefined);
    const res = (await callDelete()) as Response;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(deleteText).toHaveBeenCalledWith(VALID_ID, {
      id: USER.id,
      role: USER.role,
    });
  });

  it('rejects an invalid uuid with 400', async () => {
    const res = (await callDelete('not-a-uuid')) as { status: number };
    expect(res.status).toBe(400);
    expect(deleteText).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    const res = (await callDelete(VALID_ID, null)) as { status: number };
    expect(res.status).toBe(401);
    expect(deleteText).not.toHaveBeenCalled();
  });

  it('maps TextValidationError(404) to a 404', async () => {
    const { TextValidationError } = await import(
      '$lib/server/texts/upload.js'
    );
    deleteText.mockRejectedValueOnce(
      new TextValidationError('Text not found', 404),
    );
    const res = (await callDelete()) as { status: number };
    expect(res.status).toBe(404);
  });
});
