// @vitest-environment node
/**
 * Tests for the dictionary permission helpers (T-3.4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../db/index.js', () => ({
  db: { select: () => makeSelectChain() },
  schema: {
    curatorLanguages: {
      userId: 'curator_languages.user_id',
      language: 'curator_languages.language',
    },
  },
}));

const {
  ForbiddenError,
  canEditDictionary,
  isAdmin,
  isCuratorOrAdmin,
  listGrantedLanguages,
  requireAdmin,
  requireCanEditDictionary,
} = await import('./permissions.js');

beforeEach(() => {
  staged.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('role predicates', () => {
  it('isAdmin is true only for role=admin', () => {
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin({ role: 'user' })).toBe(false);
    expect(isAdmin({ role: 'curator' })).toBe(false);
    expect(isAdmin({ role: 'admin' })).toBe(true);
  });

  it('isCuratorOrAdmin is true for curator + admin', () => {
    expect(isCuratorOrAdmin(null)).toBe(false);
    expect(isCuratorOrAdmin({ role: 'user' })).toBe(false);
    expect(isCuratorOrAdmin({ role: 'curator' })).toBe(true);
    expect(isCuratorOrAdmin({ role: 'admin' })).toBe(true);
  });

  it('requireAdmin throws ForbiddenError for non-admins', () => {
    expect(() => requireAdmin(null)).toThrow(ForbiddenError);
    expect(() => requireAdmin({ role: 'curator' })).toThrow(ForbiddenError);
    expect(() => requireAdmin({ role: 'admin' })).not.toThrow();
  });
});

describe('canEditDictionary', () => {
  it('returns false for anonymous viewers', async () => {
    expect(await canEditDictionary(null, 'hi')).toBe(false);
  });

  it('returns false for plain users without hitting the DB', async () => {
    expect(await canEditDictionary({ id: 'u1', role: 'user' }, 'hi')).toBe(false);
  });

  it('returns true for admins without needing a grant row', async () => {
    // No staged row — function must short-circuit.
    expect(await canEditDictionary({ id: 'a1', role: 'admin' }, 'or')).toBe(true);
  });

  it('returns true for a curator when the grant exists', async () => {
    stage([{ language: 'hi' }]);
    expect(await canEditDictionary({ id: 'c1', role: 'curator' }, 'hi')).toBe(true);
  });

  it('returns false for a curator when no grant exists for that language', async () => {
    stage([]);
    expect(await canEditDictionary({ id: 'c1', role: 'curator' }, 'or')).toBe(false);
  });

  it('requireCanEditDictionary throws when canEditDictionary is false', async () => {
    stage([]);
    await expect(
      requireCanEditDictionary({ id: 'c1', role: 'curator' }, 'or'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('requireCanEditDictionary is silent when the check passes', async () => {
    await expect(
      requireCanEditDictionary({ id: 'a1', role: 'admin' }, 'hi'),
    ).resolves.toBeUndefined();
  });
});

describe('listGrantedLanguages', () => {
  it('returns every supported language for an admin without hitting the DB', async () => {
    const langs = await listGrantedLanguages({ id: 'a1', role: 'admin' });
    expect(langs.sort()).toEqual(['hi', 'mr', 'or', 'yi']);
  });

  it('returns [] for a plain user', async () => {
    expect(await listGrantedLanguages({ id: 'u1', role: 'user' })).toEqual([]);
  });

  it('returns the curator grants from the DB', async () => {
    stage([{ language: 'hi' }, { language: 'mr' }]);
    const langs = await listGrantedLanguages({ id: 'c1', role: 'curator' });
    expect(langs).toEqual(['hi', 'mr']);
  });
});
