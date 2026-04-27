// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const processTextNow = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/texts/in-process-dispatcher.js', async () => {
  const actual = await vi.importActual<
    typeof import('$lib/server/texts/in-process-dispatcher.js')
  >('$lib/server/texts/in-process-dispatcher.js');
  return {
    ...actual,
    processTextNow: (...a: unknown[]) => processTextNow(...a),
  };
});

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

type PostFn = (typeof import('./+server.js'))['POST'];

const VALID_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ADMIN = { id: 'admin-1', role: 'admin' as const };
const USER = { id: 'user-1', role: 'user' as const };

async function callPost(id = VALID_ID, user: typeof ADMIN | typeof USER | null = ADMIN) {
  if (user) requireUser.mockResolvedValueOnce(user);
  else requireUser.mockImplementationOnce(() => { throw { status: 401 }; });
  const { POST } = await import('./+server.js');
  const event = {
    params: { id },
    request: new Request(`http://x/api/v1/admin/texts/${id}/reprocess`, {
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
  processTextNow.mockReset();
  requireUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('POST /api/v1/admin/texts/:id/reprocess', () => {
  it('runs the dispatcher and returns the token count', async () => {
    processTextNow.mockResolvedValueOnce(1234);
    const res = (await callPost()) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tokensWritten).toBe(1234);
    expect(processTextNow).toHaveBeenCalledWith(VALID_ID);
  });

  it('rejects non-admins with 403', async () => {
    const res = (await callPost(VALID_ID, USER)) as { status: number };
    expect(res.status).toBe(403);
    expect(processTextNow).not.toHaveBeenCalled();
  });

  it('rejects an invalid uuid with 400', async () => {
    const res = (await callPost('not-a-uuid')) as { status: number };
    expect(res.status).toBe(400);
  });
});
