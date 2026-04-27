// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbSelect = vi.fn();
const dbInsert = vi.fn();
const dbSelectChain = {
  from: () => dbSelectChain,
  where: () => dbSelectChain,
  limit: () => Promise.resolve(dbSelect()),
};
const dbInsertChain = {
  values: () => dbInsertChain,
  returning: () => Promise.resolve(dbInsert()),
};
const hashPassword = vi.fn();
const createSession = vi.fn();
const setSessionCookie = vi.fn();

vi.mock('$lib/server/db/index.js', () => ({
  db: {
    select: () => dbSelectChain,
    insert: () => dbInsertChain,
  },
  schema: {
    users: { id: 'users.id', email: 'users.email' },
  },
}));
vi.mock('$lib/server/auth/password.js', () => ({
  hashPassword: (...a: unknown[]) => hashPassword(...a),
}));
vi.mock('$lib/server/auth/sessions.js', () => ({
  createSession: (...a: unknown[]) => createSession(...a),
  setSessionCookie: (...a: unknown[]) => setSessionCookie(...a),
}));

type Mod = typeof import('./+page.server.js');

async function callLoad(url: string, user: { id: string } | null = null) {
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

async function callDefault(fields: Record<string, string>, urlStr = 'http://x/register') {
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

beforeEach(() => {
  dbSelect.mockReset();
  dbInsert.mockReset();
  hashPassword.mockReset();
  createSession.mockReset();
  setSessionCookie.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('/register loader', () => {
  it('exposes the next param as /onboarding by default', async () => {
    const data = (await callLoad('http://x/register')) as { next: string };
    expect(data.next).toBe('/onboarding');
  });

  it('redirects an already-signed-in visitor', async () => {
    const res = (await callLoad('http://x/register', { id: 'u1' })) as {
      status: number;
    };
    expect(res.status).toBe(303);
  });
});

describe('/register default action', () => {
  it('creates the user and redirects to /onboarding by default', async () => {
    dbSelect.mockReturnValueOnce([]); // no existing user
    hashPassword.mockResolvedValueOnce('hash');
    dbInsert.mockReturnValueOnce([
      { id: 'user-1', email: 'new@example.com', displayName: 'New User' },
    ]);
    createSession.mockResolvedValueOnce({
      token: 'sess',
      expiresAt: new Date(Date.now() + 1000),
    });
    const res = (await callDefault({
      email: 'new@example.com',
      password: 'a-good-long-password',
      displayName: 'New User',
    })) as { status: number; location: string };
    expect(res.status).toBe(303);
    expect(res.location).toBe('/onboarding');
    expect(setSessionCookie).toHaveBeenCalled();
  });

  it('returns 409 when the email is already registered', async () => {
    dbSelect.mockReturnValueOnce([{ id: 'existing' }]);
    const res = (await callDefault({
      email: 'taken@example.com',
      password: 'a-good-long-password',
    })) as { status: number; data: { ok: boolean; message: string } };
    expect(res.status).toBe(409);
    expect(res.data.message).toMatch(/already exists/i);
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it('rejects a too-short password with 400', async () => {
    const res = (await callDefault({
      email: 'new@example.com',
      password: 'short',
    })) as { status: number };
    expect(res.status).toBe(400);
    expect(dbSelect).not.toHaveBeenCalled();
  });

  it('rejects an empty email', async () => {
    const res = (await callDefault({
      email: '',
      password: 'a-good-long-password',
    })) as { status: number };
    expect(res.status).toBe(400);
  });
});
