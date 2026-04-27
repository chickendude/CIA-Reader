// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { signAccessToken } from './access-token.js';

// Fabricate a minimal db + schema surface covering only the calls these
// helpers make. Drizzle's query builder returns `this` from almost everything
// and resolves the chain on await, so a chainable spy works.
const fakeRows: Array<Record<string, unknown>> = [];
const chain = {
  from: vi.fn(() => chain),
  innerJoin: vi.fn(() => chain),
  where: vi.fn(() => chain),
  limit: vi.fn(() => fakeRows),
};
const fakeDb = {
  select: vi.fn(() => chain),
};

vi.mock('../db/index.js', () => ({
  db: fakeDb,
  schema: {
    users: { id: 'users.id' },
    sessions: { id: 'sessions.id', expiresAt: 'sessions.expiresAt' },
  },
}));

// Import SUT after the mock registration.
const { resolveUser, requireUser } = await import('./require-user.js');

function makeEvent({
  bearer,
  cookie,
  locals,
}: {
  bearer?: string;
  cookie?: string;
  locals?: Record<string, unknown>;
} = {}) {
  const headers = new Headers();
  if (bearer) headers.set('authorization', `Bearer ${bearer}`);
  const cookies = {
    get: vi.fn((name: string) => (name === 'cia_session' ? cookie : undefined)),
    set: vi.fn(),
    delete: vi.fn(),
    getAll: vi.fn(() => []),
    serialize: vi.fn(() => ''),
  };
  return {
    request: { headers } as Request,
    cookies,
    locals: locals ?? {},
  } as unknown as Parameters<typeof resolveUser>[0];
}

describe('resolveUser', () => {
  beforeEach(() => {
    fakeRows.length = 0;
    Object.values(chain).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockClear());
    fakeDb.select.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('resolves via bearer token when the JWT is valid and the user exists', async () => {
    const jwt = await signAccessToken('user-xyz');
    fakeRows.push({ id: 'user-xyz', email: 'a@b.c' });
    const user = await resolveUser(makeEvent({ bearer: jwt }));
    expect(user).toMatchObject({ id: 'user-xyz' });
  });

  it('returns null for a present-but-invalid bearer token — never falls through to cookie', async () => {
    // Even if a valid cookie were present, a broken bearer should not silently succeed.
    fakeRows.push({ id: 'cookie-user' });
    const user = await resolveUser(makeEvent({ bearer: 'not.a.jwt', cookie: 'ignored' }));
    expect(user).toBeNull();
  });

  it('returns null for a valid bearer JWT whose user row is missing', async () => {
    const jwt = await signAccessToken('user-gone');
    // fakeRows empty — user row missing.
    expect(await resolveUser(makeEvent({ bearer: jwt }))).toBeNull();
  });

  it('returns null when neither a bearer nor a cookie is present', async () => {
    expect(await resolveUser(makeEvent())).toBeNull();
  });

  it('falls back to the cookie when there is no Authorization header', async () => {
    // validateSessionToken does a users⋈sessions join, so rows come back shaped
    // `{ session, user }`.
    fakeRows.push({
      session: { id: 'sid', userId: 'cookie-user', expiresAt: new Date(Date.now() + 60_000) },
      user: { id: 'cookie-user', email: 'x@y.z' },
    });
    const user = await resolveUser(makeEvent({ cookie: 'valid-session-token' }));
    expect(user).toMatchObject({ id: 'cookie-user' });
  });
});

describe('requireUser', () => {
  beforeEach(() => {
    fakeRows.length = 0;
  });

  it('uses locals.user when the hook pre-populated it', async () => {
    const preloaded = { id: 'preloaded' } as unknown as Awaited<ReturnType<typeof requireUser>>;
    const user = await requireUser(makeEvent({ locals: { user: preloaded } }));
    expect(user).toBe(preloaded);
  });

  it('throws 401 when the caller is unauthenticated', async () => {
    await expect(requireUser(makeEvent())).rejects.toMatchObject({ status: 401 });
  });
});
