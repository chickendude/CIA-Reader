// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listUserLanguages = vi.fn();
const updateUserProfile = vi.fn();
const upsertUserLanguage = vi.fn();

vi.mock('$lib/server/profile.js', () => ({
  listUserLanguages: (...a: unknown[]) => listUserLanguages(...a),
  updateUserProfile: (...a: unknown[]) => updateUserProfile(...a),
  upsertUserLanguage: (...a: unknown[]) => upsertUserLanguage(...a),
  withDefaultsForAllLanguages: (rows: unknown[]) =>
    // Keep test fixtures stable: pass through with `isDefault: false` for
    // every persisted row and nothing more. The full fallback/merge logic is
    // covered separately in profile.test.ts.
    (rows as Array<Record<string, unknown>>).map((r) => ({
      code: r.language,
      scriptPreference: r.scriptPreference,
      romanizationScheme: r.romanizationScheme,
      isDefault: false,
    })),
}));

type LoadFn = (typeof import('./+page.server.js'))['load'];
type LoadEvent = Parameters<LoadFn>[0];

type ActionsModule = (typeof import('./+page.server.js'))['actions'];
type ActionFn = NonNullable<ActionsModule[keyof ActionsModule]>;
type ActionEvent = Parameters<ActionFn>[0];

async function loadActions() {
  const mod = await import('./+page.server.js');
  return {
    updateProfile: mod.actions.updateProfile as ActionFn,
    updateLanguage: mod.actions.updateLanguage as ActionFn,
  };
}

function formEvent(fields: Record<string, string>, locals: Record<string, unknown> = {}) {
  const body = new URLSearchParams(fields);
  return {
    request: new Request('http://x/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }),
    locals,
    cookies: { set: vi.fn() },
    url: new URL('http://x/profile'),
  } as unknown as ActionEvent;
}

describe('profile +page.server.ts', () => {
  beforeEach(() => {
    listUserLanguages.mockReset();
    updateUserProfile.mockReset();
    upsertUserLanguage.mockReset();
  });

  afterEach(() => vi.resetModules());

  describe('load', () => {
    it('redirects to /login when unauthenticated', async () => {
      const { load } = await import('./+page.server.js');
      await expect(
        load({ locals: {} } as unknown as LoadEvent),
      ).rejects.toMatchObject({ status: 303 });
    });

    it('returns user + language rows (persisted + defaulted) when authenticated', async () => {
      listUserLanguages.mockResolvedValue([
        { language: 'hi', scriptPreference: 'native', romanizationScheme: 'iso15919' },
      ]);
      const { load } = await import('./+page.server.js');
      const data = await load({
        locals: {
          user: {
            id: 'u1',
            email: 'a@b.c',
            displayName: null,
            role: 'user',
            themePreference: 'system',
          },
        },
      } as unknown as LoadEvent);
      expect(data.user?.id).toBe('u1');
      expect(data.languages).toHaveLength(1);
      expect(data.languages[0]?.code).toBe('hi');
      expect(data.languages[0]?.displayName).toBe('Hindi');
      expect(data.languages[0]?.supportedRomanizations).toContain('iso15919');
    });
  });

  describe('updateProfile action', () => {
    it('rejects with 401 when unauthenticated', async () => {
      const actions = await loadActions();
      const result = await actions.updateProfile(
        formEvent({ displayName: 'X', themePreference: 'dark' }),
      );
      expect(result).toMatchObject({ status: 401, data: { ok: false } });
    });

    it('persists a valid patch', async () => {
      updateUserProfile.mockResolvedValue({ id: 'u1' });
      const actions = await loadActions();
      const result = await actions.updateProfile(
        formEvent(
          { displayName: 'Alex', themePreference: 'dark' },
          { user: { id: 'u1' } },
        ),
      );
      expect(result).toMatchObject({ ok: true, section: 'profile' });
      expect(updateUserProfile).toHaveBeenCalledWith('u1', {
        displayName: 'Alex',
        themePreference: 'dark',
      });
    });

    it('normalizes an empty displayName to null', async () => {
      updateUserProfile.mockResolvedValue({ id: 'u1' });
      const actions = await loadActions();
      await actions.updateProfile(
        formEvent({ displayName: '   ', themePreference: 'system' }, { user: { id: 'u1' } }),
      );
      expect(updateUserProfile).toHaveBeenCalledWith('u1', {
        displayName: null,
        themePreference: 'system',
      });
    });

    it('writes the cia_theme cookie mirroring the saved preference', async () => {
      updateUserProfile.mockResolvedValue({ id: 'u1' });
      const actions = await loadActions();
      const evt = formEvent(
        { displayName: 'Alex', themePreference: 'dark' },
        { user: { id: 'u1' } },
      );
      await actions.updateProfile(evt);
      const cookies = (evt as unknown as { cookies: { set: ReturnType<typeof vi.fn> } }).cookies;
      expect(cookies.set).toHaveBeenCalledWith(
        'cia_theme',
        'dark',
        expect.objectContaining({ path: '/', httpOnly: false, sameSite: 'lax' }),
      );
    });

    it('returns 400 when themePreference is invalid', async () => {
      const actions = await loadActions();
      const result = await actions.updateProfile(
        formEvent({ displayName: 'Alex', themePreference: 'chartreuse' }, { user: { id: 'u1' } }),
      );
      expect(result).toMatchObject({ status: 400, data: { ok: false } });
    });
  });

  describe('updateLanguage action', () => {
    it('rejects an unsupported language code', async () => {
      const actions = await loadActions();
      const result = await actions.updateLanguage(
        formEvent(
          {
            code: 'xx',
            scriptPreference: 'native',
            romanizationScheme: 'iso15919',
          },
          { user: { id: 'u1' } },
        ),
      );
      expect(result).toMatchObject({ status: 400, data: { ok: false } });
      expect(upsertUserLanguage).not.toHaveBeenCalled();
    });

    it("rejects a romanization scheme the language doesn't support", async () => {
      // Odia's supported schemes are iso15919, iast, itrans — hunterian is not in the list.
      const actions = await loadActions();
      const result = await actions.updateLanguage(
        formEvent(
          {
            code: 'or',
            scriptPreference: 'native',
            romanizationScheme: 'hunterian',
          },
          { user: { id: 'u1' } },
        ),
      );
      expect(result).toMatchObject({ status: 400, data: { ok: false } });
      expect(upsertUserLanguage).not.toHaveBeenCalled();
    });

    it('persists a valid per-language patch', async () => {
      upsertUserLanguage.mockResolvedValue({ language: 'hi' });
      const actions = await loadActions();
      const result = await actions.updateLanguage(
        formEvent(
          {
            code: 'hi',
            scriptPreference: 'romanization_only',
            romanizationScheme: 'iast',
          },
          { user: { id: 'u1' } },
        ),
      );
      expect(result).toMatchObject({ ok: true, section: 'language', code: 'hi' });
      expect(upsertUserLanguage).toHaveBeenCalledWith('u1', 'hi', {
        scriptPreference: 'romanization_only',
        romanizationScheme: 'iast',
      });
    });
  });
});
