// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const markTextReady = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/texts/jobs.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/texts/jobs.js')>(
    '$lib/server/texts/jobs.js',
  );
  return {
    ...actual,
    markTextReady: (...a: unknown[]) => markTextReady(...a),
  };
});

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

type PostFn = (typeof import('./+server.js'))['POST'];

const VALID_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ADMIN = { id: 'admin-1', role: 'admin' as const };
const USER = { id: 'user-1', role: 'user' as const };

async function callPost(id: string, user: typeof ADMIN | typeof USER | null = ADMIN) {
  if (user) {
    requireUser.mockResolvedValueOnce(user);
  } else {
    requireUser.mockImplementationOnce(() => {
      throw { status: 401 };
    });
  }
  const { POST } = await import('./+server.js');
  const event = {
    params: { id },
    request: new Request(`http://x/api/v1/admin/texts/${id}/mark-ready`, {
      method: 'POST',
    }),
  } as unknown as Parameters<PostFn>[0];
  try {
    return await POST(event);
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  markTextReady.mockReset();
  requireUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('POST /api/v1/admin/texts/:id/mark-ready', () => {
  it('flips the text to ready as admin', async () => {
    markTextReady.mockResolvedValueOnce(undefined);
    const res = (await callPost(VALID_ID)) as Response;
    expect(res.status).toBe(200);
    expect(markTextReady).toHaveBeenCalledWith(VALID_ID);
  });

  it('rejects non-admin callers with 403', async () => {
    const res = (await callPost(VALID_ID, USER)) as { status: number };
    expect(res.status).toBe(403);
    expect(markTextReady).not.toHaveBeenCalled();
  });

  it('rejects an invalid uuid with 400', async () => {
    const res = (await callPost('not-a-uuid')) as { status: number };
    expect(res.status).toBe(400);
  });
});
