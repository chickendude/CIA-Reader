// @vitest-environment node
/**
 * Route tests for GET + POST /api/v1/admin/users/:id/curator-languages (T-3.4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listCuratorLanguages = vi.fn();
const grantCuratorLanguage = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/dictionary/admin.js', async () => {
  const actual =
    await vi.importActual<typeof import('$lib/server/dictionary/admin.js')>(
      '$lib/server/dictionary/admin.js',
    );
  return {
    ...actual,
    listCuratorLanguages: (...a: unknown[]) => listCuratorLanguages(...a),
    grantCuratorLanguage: (...a: unknown[]) => grantCuratorLanguage(...a),
  };
});

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

type GetFn = (typeof import('./+server.js'))['GET'];
type PostFn = (typeof import('./+server.js'))['POST'];
type GetEvent = Parameters<GetFn>[0];
type PostEvent = Parameters<PostFn>[0];

async function callGet(
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
  const { GET } = await import('./+server.js');
  const event = {
    params,
    request: new Request('http://x/api/v1/admin/users/u1/curator-languages'),
  } as unknown as GetEvent;
  try {
    return await GET(event);
  } catch (e) {
    return e as { status: number };
  }
}

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
    request: new Request('http://x/api/v1/admin/users/u1/curator-languages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as PostEvent;
  try {
    return await POST(event);
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  listCuratorLanguages.mockReset();
  grantCuratorLanguage.mockReset();
  requireUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('GET /api/v1/admin/users/:id/curator-languages', () => {
  it('returns the current grants', async () => {
    listCuratorLanguages.mockResolvedValueOnce(['hi', 'mr']);
    const res = (await callGet()) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.languages).toEqual(['hi', 'mr']);
  });

  it('returns 401 when not logged in', async () => {
    const res = (await callGet(null)) as { status: number };
    expect(res.status).toBe(401);
    expect(listCuratorLanguages).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller is not an admin', async () => {
    const res = (await callGet({ id: 'c1', role: 'curator' })) as {
      status: number;
    };
    expect(res.status).toBe(403);
    expect(listCuratorLanguages).not.toHaveBeenCalled();
  });

  it('returns 400 when the id param is missing', async () => {
    const res = (await callGet({ id: 'a1', role: 'admin' }, {})) as {
      status: number;
    };
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/admin/users/:id/curator-languages', () => {
  it('grants a language and returns the updated list with 201', async () => {
    grantCuratorLanguage.mockResolvedValueOnce(undefined);
    listCuratorLanguages.mockResolvedValueOnce(['hi']);
    const res = (await callPost({ language: 'hi' })) as Response;
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.languages).toEqual(['hi']);
    expect(grantCuratorLanguage).toHaveBeenCalledWith('u1', 'hi', 'a1');
  });

  it('returns 401 when not logged in', async () => {
    const res = (await callPost({ language: 'hi' }, null)) as {
      status: number;
    };
    expect(res.status).toBe(401);
    expect(grantCuratorLanguage).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller is not an admin', async () => {
    const res = (await callPost({ language: 'hi' }, {
      id: 'c1',
      role: 'curator',
    })) as { status: number };
    expect(res.status).toBe(403);
    expect(grantCuratorLanguage).not.toHaveBeenCalled();
  });

  it('returns 400 on an unsupported language', async () => {
    const res = (await callPost({ language: 'bn' })) as { status: number };
    expect(res.status).toBe(400);
    expect(grantCuratorLanguage).not.toHaveBeenCalled();
  });

  it('returns 404 when the target user does not exist', async () => {
    const { UserNotFoundError } = await import(
      '$lib/server/dictionary/admin.js'
    );
    grantCuratorLanguage.mockRejectedValueOnce(new UserNotFoundError('u-missing'));
    const res = (await callPost({ language: 'hi' })) as { status: number };
    expect(res.status).toBe(404);
  });
});
