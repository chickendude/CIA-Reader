// @vitest-environment node
/**
 * Route tests for POST /api/v1/admin/users/:id/role (T-3.4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const setUserRole = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/dictionary/admin.js', async () => {
  const actual =
    await vi.importActual<typeof import('$lib/server/dictionary/admin.js')>(
      '$lib/server/dictionary/admin.js',
    );
  return {
    ...actual,
    setUserRole: (...a: unknown[]) => setUserRole(...a),
  };
});

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

type PostFn = (typeof import('./+server.js'))['POST'];
type PostEvent = Parameters<PostFn>[0];

async function callPost(
  body: unknown,
  user: { id: string; role?: string } | null = { id: 'a1', role: 'admin' },
  params: Record<string, string | undefined> = { id: 'u1' },
) {
  if (user) {
    requireUser.mockResolvedValueOnce(user);
  } else {
    requireUser.mockImplementationOnce(() => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 });
    });
  }
  const { POST } = await import('./+server.js');
  const event = {
    params,
    request: new Request('http://x/api/v1/admin/users/u1/role', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as PostEvent;
  try {
    return await POST(event);
  } catch (e) {
    return e as { status: number; body?: { message: string } };
  }
}

beforeEach(() => {
  setUserRole.mockReset();
  requireUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('POST /api/v1/admin/users/:id/role', () => {
  it('returns 200 with the public user shape on success', async () => {
    setUserRole.mockResolvedValueOnce({
      id: 'u1',
      email: 'u@example.com',
      role: 'curator',
      passwordHash: 'secret',
    });
    const res = (await callPost({ role: 'curator' })) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.user).toEqual({
      id: 'u1',
      email: 'u@example.com',
      role: 'curator',
    });
    // Never leaks the password hash.
    expect(json.user.passwordHash).toBeUndefined();
    expect(setUserRole).toHaveBeenCalledWith('u1', 'curator');
  });

  it('returns 401 when the caller is not logged in', async () => {
    const res = (await callPost({ role: 'curator' }, null)) as { status: number };
    expect(res.status).toBe(401);
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller is not an admin', async () => {
    const res = (await callPost(
      { role: 'curator' },
      { id: 'c1', role: 'curator' },
    )) as { status: number };
    expect(res.status).toBe(403);
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it('returns 400 when the target id param is missing', async () => {
    const res = (await callPost(
      { role: 'curator' },
      { id: 'a1', role: 'admin' },
      {},
    )) as { status: number };
    expect(res.status).toBe(400);
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it('returns 400 on an invalid role', async () => {
    const res = (await callPost({ role: 'superuser' })) as { status: number };
    expect(res.status).toBe(400);
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it('returns 404 when the target user does not exist', async () => {
    const { UserNotFoundError } = await import(
      '$lib/server/dictionary/admin.js'
    );
    setUserRole.mockRejectedValueOnce(new UserNotFoundError('u-missing'));
    const res = (await callPost({ role: 'curator' })) as { status: number };
    expect(res.status).toBe(404);
  });

  it('returns 409 when demoting the last admin', async () => {
    const { LastAdminError } = await import('$lib/server/dictionary/admin.js');
    setUserRole.mockRejectedValueOnce(new LastAdminError());
    const res = (await callPost({ role: 'user' })) as { status: number };
    expect(res.status).toBe(409);
  });
});
