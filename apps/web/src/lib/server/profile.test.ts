// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Drizzle's query builder returns `this` from most methods and resolves the
// chain on await. Tests swap out the `rows` array and the final-link behavior
// (`limit` / `returning`) to simulate different DB states.
const rows: Array<Record<string, unknown>> = [];
type ChainShape = {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
  returning: ReturnType<typeof vi.fn>;
};
const chain: ChainShape = {
  from: vi.fn(() => chain),
  where: vi.fn(() => chain),
  limit: vi.fn(() => rows),
  set: vi.fn(() => chain),
  values: vi.fn(() => chain),
  returning: vi.fn(() => rows),
};
const fakeDb = {
  select: vi.fn(() => chain),
  update: vi.fn(() => chain),
  insert: vi.fn(() => chain),
};

vi.mock('./db/index.js', () => ({
  db: fakeDb,
  schema: {
    users: { id: 'users.id' },
    userLanguages: {
      userId: 'ul.user_id',
      language: 'ul.language',
    },
  },
}));

const { updateUserProfile, upsertUserLanguage, withDefaultsForAllLanguages } = await import(
  './profile.js'
);

function resetAll() {
  rows.length = 0;
  for (const fn of Object.values(chain)) (fn as ReturnType<typeof vi.fn>).mockClear();
  fakeDb.select.mockClear();
  fakeDb.update.mockClear();
  fakeDb.insert.mockClear();
}

describe('withDefaultsForAllLanguages', () => {
  it('fills every MVP language, flagging defaults for untouched ones', () => {
    const persisted = [
      {
        userId: 'u',
        language: 'hi',
        scriptPreference: 'romanization_only',
        romanizationScheme: 'iast',
      },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const merged = withDefaultsForAllLanguages(persisted as any);
    expect(merged.map((m) => m.code).sort()).toEqual(['eu', 'hi', 'mr', 'or', 'yi']);
    const hi = merged.find((m) => m.code === 'hi')!;
    expect(hi.isDefault).toBe(false);
    expect(hi.romanizationScheme).toBe('iast');
    const or = merged.find((m) => m.code === 'or')!;
    expect(or.isDefault).toBe(true);
    expect(or.scriptPreference).toBe('native');
    expect(or.romanizationScheme).toBe('iso15919');
    // Yiddish defaults come from the registry: YIVO, not ISO 15919.
    const yi = merged.find((m) => m.code === 'yi')!;
    expect(yi.isDefault).toBe(true);
    expect(yi.romanizationScheme).toBe('yivo');
    // Basque has no romanization (Latin script); the column gets the inert
    // iso15919 default and scriptPreference stays native.
    const eu = merged.find((m) => m.code === 'eu')!;
    expect(eu.isDefault).toBe(true);
    expect(eu.scriptPreference).toBe('native');
    expect(eu.romanizationScheme).toBe('iso15919');
  });

  it('returns all-defaults when the user has no persisted rows', () => {
    const merged = withDefaultsForAllLanguages([]);
    expect(merged).toHaveLength(5);
    expect(merged.every((m) => m.isDefault)).toBe(true);
  });
});

describe('updateUserProfile', () => {
  beforeEach(() => resetAll());

  it('returns the existing user without writing when the patch is empty', async () => {
    rows.push({ id: 'u1', email: 'a@b.c' });
    const user = await updateUserProfile('u1', {});
    expect(user).toMatchObject({ id: 'u1' });
    expect(fakeDb.update).not.toHaveBeenCalled();
    expect(fakeDb.select).toHaveBeenCalledOnce();
  });

  it('updates displayName when provided', async () => {
    rows.push({ id: 'u1', email: 'a@b.c', displayName: 'Alex' });
    const user = await updateUserProfile('u1', { displayName: 'Alex' });
    expect(user.displayName).toBe('Alex');
    expect(fakeDb.update).toHaveBeenCalledOnce();
    const setArg = chain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg.displayName).toBe('Alex');
    expect(setArg.updatedAt).toBeInstanceOf(Date);
  });

  it('only updates themePreference when only that is provided', async () => {
    rows.push({ id: 'u1', themePreference: 'dark' });
    await updateUserProfile('u1', { themePreference: 'dark' });
    const setArg = chain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg.themePreference).toBe('dark');
    expect('displayName' in setArg).toBe(false);
  });

  it('throws when the user is missing', async () => {
    // rows stays empty — RETURNING yields nothing.
    await expect(updateUserProfile('nope', { displayName: 'x' })).rejects.toThrow(/not found/);
  });
});

describe('upsertUserLanguage', () => {
  beforeEach(() => resetAll());

  it('inserts a new row with defaults when the language is new for the user', async () => {
    // First call: SELECT existing → empty.
    chain.limit.mockReturnValueOnce([]);
    // Second call: INSERT ... RETURNING → the new row.
    const created = {
      userId: 'u1',
      language: 'hi',
      scriptPreference: 'native',
      romanizationScheme: 'iso15919',
    };
    chain.returning.mockReturnValueOnce([created]);
    const row = await upsertUserLanguage('u1', 'hi', {});
    expect(row).toEqual(created);
    expect(fakeDb.insert).toHaveBeenCalledOnce();
    expect(fakeDb.update).not.toHaveBeenCalled();
  });

  it('updates the existing row when the language is already present', async () => {
    chain.limit.mockReturnValueOnce([{ userId: 'u1', language: 'hi' }]);
    const updated = {
      userId: 'u1',
      language: 'hi',
      scriptPreference: 'romanization_only',
      romanizationScheme: 'iast',
    };
    chain.returning.mockReturnValueOnce([updated]);
    const row = await upsertUserLanguage('u1', 'hi', {
      scriptPreference: 'romanization_only',
      romanizationScheme: 'iast',
    });
    expect(row).toEqual(updated);
    expect(fakeDb.insert).not.toHaveBeenCalled();
    expect(fakeDb.update).toHaveBeenCalledOnce();
  });

  it('returns the existing row unchanged when the patch is empty', async () => {
    const existing = { userId: 'u1', language: 'hi', scriptPreference: 'native' };
    chain.limit.mockReturnValueOnce([existing]);
    const row = await upsertUserLanguage('u1', 'hi', {});
    expect(row).toBe(existing);
    expect(fakeDb.update).not.toHaveBeenCalled();
  });

  it('writes T-5.1b reader-popover columns when supplied', async () => {
    chain.limit.mockReturnValueOnce([{ userId: 'u1', language: 'hi' }]);
    const updated = {
      userId: 'u1',
      language: 'hi',
      readerLayoutMode: 'page',
      fontSize: 22,
      readingWidth: 'wide',
    };
    chain.returning.mockReturnValueOnce([updated]);
    await upsertUserLanguage('u1', 'hi', {
      readerLayoutMode: 'page',
      fontSize: 22,
      readingWidth: 'wide',
      fontFamily: 'Mukta',
    });
    const setArg = chain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg.readerLayoutMode).toBe('page');
    expect(setArg.fontSize).toBe(22);
    expect(setArg.readingWidth).toBe('wide');
    expect(setArg.fontFamily).toBe('Mukta');
    // Untouched fields stay out of the SET clause so we don't keep
    // bumping defaults for no reason.
    expect('lineSpacing' in setArg).toBe(false);
  });

  it('inserts T-5.1b reader-popover columns on first save', async () => {
    chain.limit.mockReturnValueOnce([]);
    chain.returning.mockReturnValueOnce([
      {
        userId: 'u1',
        language: 'hi',
        fontSize: 24,
        readingWidth: 'narrow',
      },
    ]);
    await upsertUserLanguage('u1', 'hi', {
      fontSize: 24,
      readingWidth: 'narrow',
    });
    const insertArg = chain.values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertArg.fontSize).toBe(24);
    expect(insertArg.readingWidth).toBe('narrow');
  });
});
