// @vitest-environment node
/**
 * Tests for /login page (T-1.1 UI side).
 *
 * The auth backend (sessions, password verify, magic-link) lives in
 * lib/server/auth and has its own coverage. This suite exercises the
 * page-action plumbing: validation, redirect-on-success,
 * fail-on-bad-credentials, magic-link non-leak.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbSelect = vi.fn();
const dbSelectChain = {
  from: () => dbSelectChain,
  where: () => dbSelectChain,
  limit: () => Promise.resolve(dbSelect()),
};
const verifyPassword = vi.fn();
const createSession = vi.fn();
const setSessionCookie = vi.fn();
const createMagicLink = vi.fn();
const sendMail = vi.fn();

vi.mock('$lib/server/db/index.js', () => ({
  db: { select: () => dbSelectChain },
  schema: {
    users: {
      id: 'users.id',
      email: 'users.email',
      passwordHash: 'users.password_hash',
    },
  },
}));

vi.mock('$lib/server/auth/password.js', () => ({
  verifyPassword: (...a: unknown[]) => verifyPassword(...a),
}));
vi.mock('$lib/server/auth/sessions.js', () => ({
  createSession: (...a: unknown[]) => createSession(...a),
  setSessionCookie: (...a: unknown[]) => setSessionCookie(...a),
}));
vi.mock('$lib/server/auth/magic-link.js', () => ({
  createMagicLink: (...a: unknown[]) => createMagicLink(...a),
}));
vi.mock('$lib/server/email/index.js', () => ({
  sendMail: (...a: unknown[]) => sendMail(...a),
  buildMagicLinkEmail: (email: string, link: string) => ({
    to: email,
    subject: 'Sign in',
    body: link,
  }),
}));
vi.mock('$lib/server/env.js', () => ({
  APP_BASE_URL: 'http://localhost:5173',
  REDIS_URL: 'redis://localhost:6379',
}));

type Mod = typeof import('./+page.server.js');

const USER_ROW = {
  id: 'user-1',
  email: 'user@example.com',
  passwordHash: 'hash',
  displayName: null,
  role: 'user' as const,
};

async function callLoad(
  url: string,
  user: { id: string } | null = null,
) {
  const { load } = (await import('./+page.server.js')) as Mod;
  const event = {
    locals: { user },
    url: new URL(url),
  } as unknown as Parameters<Mod['load']>[0];
  try {
    return load(event);
  } catch (e) {
    return e as { status: number; location?: string };
  }
}

async function callDefault(fields: Record<string, string>, urlStr = 'http://x/login') {
  const { actions } = (await import('./+page.server.js')) as Mod;
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const event = {
    request: { formData: () => Promise.resolve(fd) } as unknown as Request,
    cookies: {} as unknown,
    url: new URL(urlStr),
  } as unknown as Parameters<Mod['actions']['default']>[0];
  try {
    return await actions.default!(event);
  } catch (e) {
    return e as { status: number; location?: string };
  }
}

async function callMagic(fields: Record<string, string>) {
  const { actions } = (await import('./+page.server.js')) as Mod;
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const event = {
    request: { formData: () => Promise.resolve(fd) } as unknown as Request,
  } as unknown as Parameters<Mod['actions']['magic']>[0];
  return actions.magic!(event);
}

beforeEach(() => {
  dbSelect.mockReset();
  verifyPassword.mockReset();
  createSession.mockReset();
  setSessionCookie.mockReset();
  createMagicLink.mockReset();
  sendMail.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('/login loader', () => {
  it('renders the form for an anonymous visitor', async () => {
    const data = (await callLoad('http://x/login')) as { next: string };
    expect(data.next).toBe('/library');
  });

  it('redirects an already-signed-in visitor to ?next= or /library', async () => {
    const res = (await callLoad('http://x/login?next=/upload', { id: 'u1' })) as {
      status: number;
      location: string;
    };
    expect(res.status).toBe(303);
    expect(res.location).toBe('/upload');
  });

  it('clamps next to same-origin paths to prevent open-redirect', async () => {
    const res = (await callLoad(
      'http://x/login?next=//evil.example.com',
      { id: 'u1' },
    )) as { status: number; location: string };
    expect(res.status).toBe(303);
    expect(res.location).toBe('/library');
  });
});

describe('/login default action', () => {
  it('signs the user in and redirects to ?next=', async () => {
    dbSelect.mockReturnValueOnce([USER_ROW]);
    verifyPassword.mockResolvedValueOnce(true);
    createSession.mockResolvedValueOnce({
      token: 'sess',
      expiresAt: new Date(Date.now() + 1000),
    });
    const res = (await callDefault(
      { email: 'user@example.com', password: 'correct horse battery staple' },
      'http://x/login?next=/upload',
    )) as { status: number; location: string };
    expect(res.status).toBe(303);
    expect(res.location).toBe('/upload');
    expect(setSessionCookie).toHaveBeenCalled();
  });

  it('returns 401 on invalid email', async () => {
    dbSelect.mockReturnValueOnce([]); // no user
    const res = (await callDefault({
      email: 'nobody@example.com',
      password: 'whatever',
    })) as { status: number; data: { ok: boolean; message: string } };
    expect(res.status).toBe(401);
    expect(res.data.message).toMatch(/invalid email or password/i);
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it('returns 401 on wrong password', async () => {
    dbSelect.mockReturnValueOnce([USER_ROW]);
    verifyPassword.mockResolvedValueOnce(false);
    const res = (await callDefault({
      email: 'user@example.com',
      password: 'guess',
    })) as { status: number };
    expect(res.status).toBe(401);
  });

  it('rejects an empty email with 400', async () => {
    const res = (await callDefault({ email: '', password: 'x' })) as {
      status: number;
    };
    expect(res.status).toBe(400);
  });
});

describe('/login magic action', () => {
  it('always responds with the same success message even for an unknown email', async () => {
    dbSelect.mockReturnValueOnce([]);
    const res = (await callMagic({ email: 'unknown@example.com' })) as {
      ok: boolean;
      message: string;
    };
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/unknown@example.com/);
    expect(createMagicLink).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('sends the link when the email matches', async () => {
    dbSelect.mockReturnValueOnce([USER_ROW]);
    createMagicLink.mockResolvedValueOnce('signed-token');
    sendMail.mockResolvedValueOnce(undefined);
    const res = (await callMagic({ email: 'user@example.com' })) as {
      ok: boolean;
    };
    expect(res.ok).toBe(true);
    expect(createMagicLink).toHaveBeenCalledWith('user-1');
    expect(sendMail).toHaveBeenCalled();
  });

  it('rejects a malformed email with 400', async () => {
    const res = (await callMagic({ email: 'not-an-email' })) as {
      status: number;
    };
    expect(res.status).toBe(400);
  });
});
