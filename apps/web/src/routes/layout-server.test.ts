// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the user_languages query — the layout loader pulls active
// languages for the rail picker (T-5.25).
const userLanguageRows = vi.fn<
  () => Promise<Array<{ language: string }>>
>();
vi.mock('$lib/server/db/index.js', () => ({
  db: {
    select() {
      return {
        from() {
          return {
            where: () => userLanguageRows(),
          };
        },
      };
    },
  },
}));

const { load } = await import('./+layout.server.js');

type LoadEvent = Parameters<typeof load>[0];

function makeEvent({
  locals,
  cookie,
}: {
  locals: Record<string, unknown>;
  cookie?: string;
}): LoadEvent {
  return {
    locals,
    cookies: {
      get: (name: string) => (name === 'cia_lang' ? cookie : undefined),
    },
  } as unknown as LoadEvent;
}

beforeEach(() => {
  userLanguageRows.mockReset();
  userLanguageRows.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('root +layout.server.ts load', () => {
  it('returns a null user when nobody is signed in', async () => {
    const data = await load(makeEvent({ locals: {} }));
    if (!data) throw new Error('load returned void');
    expect(data.user).toBeNull();
    expect(data.availableLanguages).toEqual([]);
    expect(userLanguageRows).not.toHaveBeenCalled();
  });

  it('serializes only the public user fields when signed in', async () => {
    const data = await load(
      makeEvent({
        locals: {
          user: {
            id: 'u1',
            email: 'a@b.c',
            displayName: 'Alex',
            role: 'user',
            emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
            // Fields that must NOT leak via the layout loader — these live on
            // the full User type but are not safe to send to every page.
            passwordHash: 'secret',
            themePreference: 'dark',
          },
        },
      }),
    );
    if (!data) throw new Error('load returned void');
    expect(data.user).toEqual({
      id: 'u1',
      email: 'a@b.c',
      displayName: 'Alex',
      role: 'user',
      // T-11.7: layout exposes a boolean flag, not the raw timestamp.
      emailVerified: true,
    });
  });

  it("includes the user's active languages in availableLanguages (T-5.25)", async () => {
    userLanguageRows.mockResolvedValue([{ language: 'hi' }, { language: 'mr' }]);
    const data = await load(
      makeEvent({
        locals: { user: { id: 'u1', email: 'a@b.c', displayName: null, role: 'user' } },
        cookie: 'mr',
      }),
    );
    if (!data) throw new Error('load returned void');
    expect(data.availableLanguages.map((l: { code: string }) => l.code)).toEqual(['hi', 'mr']);
    expect(data.currentLanguage).toBe('mr');
  });

  it('lists not-yet-added supported languages in addableLanguages (#436)', async () => {
    userLanguageRows.mockResolvedValue([{ language: 'hi' }, { language: 'mr' }]);
    const data = await load(
      makeEvent({
        locals: { user: { id: 'u1', email: 'a@b.c', displayName: null, role: 'user' } },
        cookie: 'hi',
      }),
    );
    if (!data) throw new Error('load returned void');
    const codes = data.addableLanguages.map((l: { code: string }) => l.code);
    expect(codes).not.toContain('hi');
    expect(codes).not.toContain('mr');
    // The remaining MVP languages are offered for one-tap add.
    expect(codes).toEqual(expect.arrayContaining(['or']));
  });

  it('offers no addableLanguages to anonymous visitors (#436)', async () => {
    const data = await load(makeEvent({ locals: {} }));
    if (!data) throw new Error('load returned void');
    expect(data.addableLanguages).toEqual([]);
  });

  it('falls back when the cia_lang cookie does not match an active language', async () => {
    userLanguageRows.mockResolvedValue([{ language: 'hi' }]);
    const data = await load(
      makeEvent({
        locals: { user: { id: 'u1', email: 'a@b.c', displayName: null, role: 'user' } },
        cookie: 'or', // user has no Odia row → cookie ignored, falls back to first active
      }),
    );
    if (!data) throw new Error('load returned void');
    expect(data.currentLanguage).toBe('hi');
  });

  it('does not 500 when the user_languages query throws', async () => {
    userLanguageRows.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const data = await load(
      makeEvent({
        locals: { user: { id: 'u1', email: 'a@b.c', displayName: null, role: 'user' } },
      }),
    );
    if (!data) throw new Error('load returned void');
    // Picker is empty but the layout still renders.
    expect(data.availableLanguages).toEqual([]);
  });
});
