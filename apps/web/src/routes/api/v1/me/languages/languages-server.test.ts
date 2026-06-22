// @vitest-environment node
/**
 * Route tests for POST /api/v1/me/languages (#436): add a language to the
 * user's list and switch to it in one request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const upsertUserLanguage = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/profile.js', () => ({
  upsertUserLanguage: (...a: unknown[]) => upsertUserLanguage(...a),
  // GET imports these; not exercised here, but the named bindings must exist.
  listUserLanguages: vi.fn(),
  withDefaultsForAllLanguages: vi.fn(),
}));

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

type Post = (typeof import('./+server.js'))['POST'];

function makeCookies() {
  const set = vi.fn();
  return { set, get: vi.fn(), delete: vi.fn(), serialize: vi.fn() };
}

async function callPost(body: unknown, cookies = makeCookies()) {
  const { POST } = await import('./+server.js');
  const event = {
    locals: { user: { id: 'u1' } },
    cookies,
    request: new Request('http://x/api/v1/me/languages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as Parameters<Post>[0];
  try {
    return { res: (await POST(event)) as Response, cookies };
  } catch (e) {
    return { res: e as { status: number }, cookies };
  }
}

beforeEach(() => {
  upsertUserLanguage.mockReset();
  upsertUserLanguage.mockResolvedValue({ userId: 'u1', language: 'mr' });
  requireUser.mockReset();
  requireUser.mockResolvedValue({ id: 'u1' });
});

afterEach(() => vi.resetModules());

describe('POST /api/v1/me/languages', () => {
  it('adds the language with an empty patch and echoes the code', async () => {
    const { res } = await callPost({ code: 'mr' });
    expect((res as Response).status).toBe(200);
    expect(await (res as Response).json()).toEqual({ code: 'mr' });
    expect(upsertUserLanguage).toHaveBeenCalledWith('u1', 'mr', {});
  });

  it('sets the current-language cookie so add == switch', async () => {
    const { res, cookies } = await callPost({ code: 'mr' });
    expect((res as Response).status).toBe(200);
    expect(cookies.set).toHaveBeenCalledWith(
      'cia_lang',
      'mr',
      expect.objectContaining({ path: '/' }),
    );
  });

  it('rejects an unsupported language with 400 and writes nothing', async () => {
    const { res } = await callPost({ code: 'xx' });
    expect((res as { status: number }).status).toBe(400);
    expect(upsertUserLanguage).not.toHaveBeenCalled();
  });

  it('401s an anonymous caller before touching the DB', async () => {
    requireUser.mockImplementation(() => {
      throw { status: 401 };
    });
    const { res } = await callPost({ code: 'mr' });
    expect((res as { status: number }).status).toBe(401);
    expect(upsertUserLanguage).not.toHaveBeenCalled();
  });
});
