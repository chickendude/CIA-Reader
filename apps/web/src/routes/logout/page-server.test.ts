// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invalidateSession = vi.fn();
const clearSessionCookie = vi.fn();
const readSessionCookie = vi.fn();

vi.mock('$lib/server/auth/sessions.js', () => ({
  invalidateSession: (...a: unknown[]) => invalidateSession(...a),
  clearSessionCookie: (...a: unknown[]) => clearSessionCookie(...a),
  readSessionCookie: (...a: unknown[]) => readSessionCookie(...a),
}));

type Mod = typeof import('./+page.server.js');

async function callLoad() {
  const { load } = (await import('./+page.server.js')) as Mod;
  try {
    return load({} as unknown as Parameters<Mod['load']>[0]);
  } catch (e) {
    return e as { status: number; location?: string };
  }
}

async function callDefault() {
  const { actions } = (await import('./+page.server.js')) as Mod;
  const event = {
    cookies: {} as unknown,
    url: new URL('http://x/logout'),
  } as unknown as Parameters<Mod['actions']['default']>[0];
  try {
    return await actions.default!(event);
  } catch (e) {
    return e as { status: number; location?: string };
  }
}

beforeEach(() => {
  invalidateSession.mockReset();
  clearSessionCookie.mockReset();
  readSessionCookie.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('/logout', () => {
  it('GET redirects home without doing anything destructive', async () => {
    const res = (await callLoad()) as { status: number; location: string };
    expect(res.status).toBe(303);
    expect(res.location).toBe('/');
    expect(invalidateSession).not.toHaveBeenCalled();
    expect(clearSessionCookie).not.toHaveBeenCalled();
  });

  it('POST clears the session cookie + invalidates the session row', async () => {
    readSessionCookie.mockReturnValueOnce('session-token');
    invalidateSession.mockResolvedValueOnce(undefined);
    const res = (await callDefault()) as { status: number; location: string };
    expect(res.status).toBe(303);
    expect(res.location).toBe('/');
    expect(invalidateSession).toHaveBeenCalledWith('session-token');
    expect(clearSessionCookie).toHaveBeenCalled();
  });

  it('still clears the cookie even when no session token was present', async () => {
    readSessionCookie.mockReturnValueOnce(null);
    const res = (await callDefault()) as { status: number; location: string };
    expect(res.status).toBe(303);
    expect(invalidateSession).not.toHaveBeenCalled();
    expect(clearSessionCookie).toHaveBeenCalled();
  });
});
