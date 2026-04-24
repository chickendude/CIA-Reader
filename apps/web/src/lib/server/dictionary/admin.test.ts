// @vitest-environment node
/**
 * Tests for the admin write helpers (T-3.4): role changes and curator-
 * language grants. The db surface is mocked; each test stages the rows
 * each call should return in the order the service issues them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Call =
  | { kind: 'select' }
  | { kind: 'update'; set?: unknown; where?: unknown }
  | { kind: 'insert'; values?: unknown; onConflict?: unknown }
  | { kind: 'delete'; where?: unknown };
const calls: Call[] = [];

const staged: Array<unknown[]> = [];
function stage(rows: unknown[]) {
  staged.push(rows);
}
function nextStaged(): unknown[] {
  const v = staged.shift();
  if (!v) throw new Error('Test bug: no staged result available');
  return v;
}

function makeSelectChain() {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(nextStaged());
  return chain;
}

function makeUpdateChain() {
  const entry: Call = { kind: 'update' };
  calls.push(entry);
  const chain: Record<string, unknown> = {};
  chain.set = vi.fn((v: unknown) => {
    entry.set = v;
    return chain;
  });
  chain.where = vi.fn((v: unknown) => {
    entry.where = v;
    return chain;
  });
  chain.returning = vi.fn(() => nextStaged());
  return chain;
}

function makeInsertChain() {
  const entry: Call = { kind: 'insert' };
  calls.push(entry);
  const chain: Record<string, unknown> = {};
  chain.values = vi.fn((v: unknown) => {
    entry.values = v;
    return chain;
  });
  chain.onConflictDoNothing = vi.fn((v: unknown) => {
    entry.onConflict = v;
    return chain;
  });
  // Insert without .returning() must still be awaitable.
  chain.then = (resolve: (v: unknown) => unknown) => resolve(undefined);
  return chain;
}

function makeDeleteChain() {
  const entry: Call = { kind: 'delete' };
  calls.push(entry);
  const chain: Record<string, unknown> = {};
  chain.where = vi.fn((v: unknown) => {
    entry.where = v;
    return chain;
  });
  chain.then = (resolve: (v: unknown) => unknown) => resolve(undefined);
  return chain;
}

const selectFn = vi.fn(() => {
  calls.push({ kind: 'select' });
  return makeSelectChain();
});
const updateFn = vi.fn(() => makeUpdateChain());
const insertFn = vi.fn(() => makeInsertChain());
const deleteFn = vi.fn(() => makeDeleteChain());

vi.mock('../db/index.js', () => ({
  db: {
    select: () => selectFn(),
    update: () => updateFn(),
    insert: () => insertFn(),
    delete: () => deleteFn(),
  },
  schema: {
    users: {
      id: 'users.id',
      role: 'users.role',
    },
    curatorLanguages: {
      userId: 'curator_languages.user_id',
      language: 'curator_languages.language',
    },
  },
}));

const {
  LastAdminError,
  UserNotFoundError,
  grantCuratorLanguage,
  listCuratorLanguages,
  revokeCuratorLanguage,
  setUserRole,
} = await import('./admin.js');

beforeEach(() => {
  calls.length = 0;
  staged.length = 0;
  selectFn.mockClear();
  updateFn.mockClear();
  insertFn.mockClear();
  deleteFn.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('setUserRole', () => {
  it('promotes a plain user to curator', async () => {
    stage([{ id: 'u1', role: 'user' }]); // existing user lookup
    stage([
      { id: 'u1', email: 'a@b', role: 'curator', updatedAt: new Date() },
    ]); // update ... returning
    const updated = await setUserRole('u1', 'curator');
    expect(updated.role).toBe('curator');
    expect(updateFn).toHaveBeenCalledTimes(1);
  });

  it('keeps a role change idempotent when target == current', async () => {
    stage([{ id: 'u1', role: 'curator' }]);
    stage([{ id: 'u1', email: 'a@b', role: 'curator', updatedAt: new Date() }]);
    const updated = await setUserRole('u1', 'curator');
    expect(updated.role).toBe('curator');
  });

  it('throws UserNotFoundError when the user does not exist', async () => {
    stage([]); // no user
    await expect(setUserRole('u-missing', 'curator')).rejects.toBeInstanceOf(
      UserNotFoundError,
    );
    expect(updateFn).not.toHaveBeenCalled();
  });

  it('allows demoting an admin when other admins exist', async () => {
    stage([{ id: 'a1', role: 'admin' }]); // existing user
    stage([{ id: 'a1' }, { id: 'a2' }]); // countAdmins -> 2
    stage([{ id: 'a1', email: 'a@b', role: 'curator', updatedAt: new Date() }]);
    const updated = await setUserRole('a1', 'curator');
    expect(updated.role).toBe('curator');
  });

  it('refuses to demote the very last admin', async () => {
    stage([{ id: 'a1', role: 'admin' }]);
    stage([{ id: 'a1' }]); // countAdmins -> 1
    await expect(setUserRole('a1', 'user')).rejects.toBeInstanceOf(LastAdminError);
    expect(updateFn).not.toHaveBeenCalled();
  });

  it('does NOT count admins when the target role is admin (no demotion)', async () => {
    stage([{ id: 'u1', role: 'user' }]);
    stage([{ id: 'u1', email: 'a@b', role: 'admin', updatedAt: new Date() }]);
    const updated = await setUserRole('u1', 'admin');
    expect(updated.role).toBe('admin');
    // Exactly one SELECT (the user lookup) — no countAdmins select.
    expect(calls.filter((c) => c.kind === 'select')).toHaveLength(1);
  });
});

describe('grantCuratorLanguage', () => {
  it('inserts a grant with onConflictDoNothing so a repeat is a no-op', async () => {
    stage([{ id: 'u1' }]); // user exists
    await grantCuratorLanguage('u1', 'hi', 'admin-1');
    const insertCall = calls.find((c) => c.kind === 'insert');
    expect(insertCall?.values).toMatchObject({
      userId: 'u1',
      language: 'hi',
      grantedBy: 'admin-1',
    });
    expect(insertCall?.onConflict).toBeDefined();
  });

  it('throws UserNotFoundError when the user does not exist', async () => {
    stage([]);
    await expect(
      grantCuratorLanguage('u-missing', 'hi', 'admin-1'),
    ).rejects.toBeInstanceOf(UserNotFoundError);
    expect(insertFn).not.toHaveBeenCalled();
  });
});

describe('revokeCuratorLanguage', () => {
  it('issues a delete against curator_languages', async () => {
    await revokeCuratorLanguage('u1', 'hi');
    expect(deleteFn).toHaveBeenCalledTimes(1);
    expect(calls.find((c) => c.kind === 'delete')?.where).toBeDefined();
  });

  it('is silent when the grant did not exist (no existence check)', async () => {
    await expect(revokeCuratorLanguage('u-none', 'or')).resolves.toBeUndefined();
  });
});

describe('listCuratorLanguages', () => {
  it('returns the language codes from the DB rows', async () => {
    stage([{ language: 'hi' }, { language: 'mr' }]);
    const langs = await listCuratorLanguages('u1');
    expect(langs).toEqual(['hi', 'mr']);
  });

  it('returns [] when the user has no grants', async () => {
    stage([]);
    const langs = await listCuratorLanguages('u1');
    expect(langs).toEqual([]);
  });
});
