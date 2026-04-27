// @vitest-environment node
/**
 * Route tests for DELETE /api/v1/admin/users/:id/curator-languages/:language (T-3.4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listCuratorLanguages = vi.fn();
const revokeCuratorLanguage = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/dictionary/admin.js', async () => {
  const actual =
    await vi.importActual<typeof import('$lib/server/dictionary/admin.js')>(
      '$lib/server/dictionary/admin.js',
    );
  return {
    ...actual,
    listCuratorLanguages: (...a: unknown[]) => listCuratorLanguages(...a),
    revokeCuratorLanguage: (...a: unknown[]) => revokeCuratorLanguage(...a),
  };
});

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

type DeleteFn = (typeof import('./+server.js'))['DELETE'];
type DeleteEvent = Parameters<DeleteFn>[0];

async function callDelete(
  user: { id: string; role?: string } | null = { id: 'a1', role: 'admin' },
  params: Record<string, string | undefined> = { id: 'u1', language: 'hi' },
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
    params,
    request: new Request(
      `http://x/api/v1/admin/users/${params.id}/curator-languages/${params.language}`,
      { method: 'DELETE' },
    ),
  } as unknown as DeleteEvent;
  try {
    return await DELETE(event);
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  listCuratorLanguages.mockReset();
  revokeCuratorLanguage.mockReset();
  requireUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('DELETE /api/v1/admin/users/:id/curator-languages/:language', () => {
  it('revokes and returns the updated list', async () => {
    revokeCuratorLanguage.mockResolvedValueOnce(undefined);
    listCuratorLanguages.mockResolvedValueOnce(['mr']);
    const res = (await callDelete()) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.languages).toEqual(['mr']);
    expect(revokeCuratorLanguage).toHaveBeenCalledWith('u1', 'hi');
  });

  it('is silent-success even when the grant did not exist', async () => {
    revokeCuratorLanguage.mockResolvedValueOnce(undefined);
    listCuratorLanguages.mockResolvedValueOnce([]);
    const res = (await callDelete()) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.languages).toEqual([]);
  });

  it('returns 401 when not logged in', async () => {
    const res = (await callDelete(null)) as { status: number };
    expect(res.status).toBe(401);
    expect(revokeCuratorLanguage).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller is not an admin', async () => {
    const res = (await callDelete({ id: 'c1', role: 'curator' })) as {
      status: number;
    };
    expect(res.status).toBe(403);
    expect(revokeCuratorLanguage).not.toHaveBeenCalled();
  });

  it('returns 400 on an unsupported language', async () => {
    const res = (await callDelete(
      { id: 'a1', role: 'admin' },
      { id: 'u1', language: 'bn' },
    )) as { status: number };
    expect(res.status).toBe(400);
    expect(revokeCuratorLanguage).not.toHaveBeenCalled();
  });

  it('returns 400 when the id param is missing', async () => {
    const res = (await callDelete(
      { id: 'a1', role: 'admin' },
      { language: 'hi' },
    )) as { status: number };
    expect(res.status).toBe(400);
    expect(revokeCuratorLanguage).not.toHaveBeenCalled();
  });
});
