// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbSelect = vi.fn();
const dbSelectChain = {
  from: () => dbSelectChain,
  where: () => dbSelectChain,
  limit: () => Promise.resolve(dbSelect()),
};
const checkPasswordLogin = vi.fn();
const setHeaders = vi.fn();
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

vi.mock('$lib/server/auth/password-access.js', async importOriginal => ({
  ...await importOriginal<typeof import('$lib/server/auth/password-access.js')>(),
  checkPasswordLogin: (...a: unknown[]) => checkPasswordLogin(...a),
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
  emailVerifiedAt: new Date(),
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
    cookies: {} as unknown, setHeaders,
    url: new URL(urlStr),
  } as unknown as Parameters<Mod['actions']['signin']>[0];
  try {
    return await actions.signin!(event);
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
  checkPasswordLogin.mockReset();
  setHeaders.mockReset();
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

  it('surfaces ?auth_error=invalid_magic_link as a friendly inline message', async () => {
    const data = (await callLoad(
      'http://x/login?auth_error=invalid_magic_link',
    )) as { next: string; authError: string | null };
    expect(data.authError).toMatch(/invalid or has expired/i);
  });

  it('renders (does NOT redirect) when a logged-in user lands here with auth_error', async () => {
    // Without this, an unverified user who clicks an expired
    // verification link gets bounced to /library and never finds out
    // the link failed.
    const data = (await callLoad(
      'http://x/login?auth_error=invalid_magic_link',
      { id: 'logged-in-user' },
    )) as { authError: string | null; alreadySignedIn: boolean };
    expect(data.authError).toMatch(/invalid or has expired/i);
    expect(data.alreadySignedIn).toBe(true);
  });

  it('signals alreadySignedIn=false for anonymous visitors so the forms render', async () => {
    const data = (await callLoad('http://x/login')) as {
      authError: string | null;
      alreadySignedIn: boolean;
    };
    expect(data.alreadySignedIn).toBe(false);
    expect(data.authError).toBeNull();
  });

  it('ignores unknown ?auth_error values without crashing', async () => {
    const data = (await callLoad('http://x/login?auth_error=bogus')) as {
      authError: string | null;
    };
    expect(data.authError).toBeNull();
  });

  it('returns authError: null when no error param is present', async () => {
    const data = (await callLoad('http://x/login')) as { authError: string | null };
    expect(data.authError).toBeNull();
  });
});

describe('/login signin action', () => {
  it('signs the user in and redirects to ?next=', async () => {
    checkPasswordLogin.mockResolvedValueOnce({ status: 'authenticated', user: USER_ROW });
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
    checkPasswordLogin.mockResolvedValueOnce({ status: 'invalid' });
    const res = (await callDefault({
      email: 'nobody@example.com',
      password: 'whatever',
    })) as { status: number; data: { ok: boolean; message: string } };
    expect(res.status).toBe(401);
    expect(res.data.message).toMatch(/invalid email or password/i);
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it('returns 401 on wrong password', async () => {
    checkPasswordLogin.mockResolvedValueOnce({ status: 'invalid' });
    const res = (await callDefault({
      email: 'user@example.com',
      password: 'guess',
    })) as { status: number };
    expect(res.status).toBe(401);
  });

  it('returns the remaining wait and does not create a session during cooldown', async () => {
    checkPasswordLogin.mockResolvedValueOnce({ status: 'limited', retryAfter: 65 });
    const res = await callDefault({ email: 'user@example.com', password: 'guess' });
    expect(res).toMatchObject({ status: 429, data: { message: 'Too many sign-in attempts. Try again in 2 minutes.' } });
    expect(setHeaders).toHaveBeenCalledWith({ 'retry-after': '65' });
    expect(createSession).not.toHaveBeenCalled();
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

  it('keeps unverified sign-in requests in the shared quota and gives a neutral response when it is full', async () => {
    dbSelect.mockReturnValueOnce([{ ...USER_ROW, emailVerifiedAt: null }]);
    createMagicLink.mockResolvedValueOnce(null);
    const result = await callMagic({ email: USER_ROW.email });
    dbSelect.mockReturnValueOnce([]);
    expect(await callMagic({ email: USER_ROW.email })).toEqual(result);
    expect(createMagicLink).toHaveBeenCalledWith(USER_ROW.id, false);
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
    expect(createMagicLink).toHaveBeenCalledWith('user-1', true);
    expect(sendMail).toHaveBeenCalled();
  });

  it('rejects a malformed email with 400', async () => {
    const res = (await callMagic({ email: 'not-an-email' })) as {
      status: number;
    };
    expect(res.status).toBe(400);
  });
});
