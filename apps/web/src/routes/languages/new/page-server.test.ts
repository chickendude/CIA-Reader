// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SUPPORTED_LANGUAGE_CODES } from '@ciareader/shared-types';

const listUserLanguages = vi.fn();
const addUserLanguage = vi.fn();

vi.mock('$lib/server/profile.js', () => ({
  listUserLanguages: (...a: unknown[]) => listUserLanguages(...a),
}));
vi.mock('$lib/server/user-languages.js', () => ({
  addUserLanguage: (...a: unknown[]) => addUserLanguage(...a),
}));

type Mod = typeof import('./+page.server.js');
const USER = { id: 'u1' };

function makeCookies() {
  return { set: vi.fn(), get: vi.fn(), delete: vi.fn(), serialize: vi.fn() };
}

async function callLoad(user: typeof USER | null) {
  const { load } = (await import('./+page.server.js')) as Mod;
  const event = {
    locals: { user },
    url: new URL('http://x/languages/new'),
  } as unknown as Parameters<Mod['load']>[0];
  try {
    return await load(event);
  } catch (e) {
    return e as { status: number; location?: string };
  }
}

async function callAction(
  fields: { language?: string; baseline?: string },
  user: typeof USER | null = USER,
  cookies = makeCookies(),
) {
  const { actions } = (await import('./+page.server.js')) as Mod;
  const fd = new FormData();
  if (fields.language !== undefined) fd.append('language', fields.language);
  if (fields.baseline !== undefined) fd.append('baseline', fields.baseline);
  const event = {
    locals: { user },
    cookies,
    url: new URL('http://x/languages/new'),
    request: { formData: () => Promise.resolve(fd) } as unknown as Request,
  } as unknown as Parameters<Mod['actions']['default']>[0];
  try {
    return { res: await actions.default!(event), cookies };
  } catch (e) {
    return { res: e as { status: number; location?: string }, cookies };
  }
}

beforeEach(() => {
  listUserLanguages.mockReset();
  listUserLanguages.mockResolvedValue([{ language: 'hi' }]);
  addUserLanguage.mockReset();
  addUserLanguage.mockResolvedValue(undefined);
});

afterEach(() => vi.resetModules());

describe('/languages/new loader', () => {
  it('redirects anonymous visitors to /login with a next param', async () => {
    const res = (await callLoad(null)) as { status: number; location: string };
    expect(res.status).toBe(303);
    expect(res.location).toBe('/login?next=%2Flanguages%2Fnew');
  });

  it('offers the supported languages the user has not added yet', async () => {
    const data = (await callLoad(USER)) as {
      addable: Array<{ code: string }>;
      baselines: readonly string[];
    };
    const codes = data.addable.map((l) => l.code);
    expect(codes).not.toContain('hi'); // already added
    expect(codes.length).toBe(SUPPORTED_LANGUAGE_CODES.length - 1);
    expect(data.baselines).toEqual(['none', 'beginner', 'intermediate']);
  });
});

describe('/languages/new add action', () => {
  it('adds the chosen language with its baseline, switches, and redirects to /library', async () => {
    const { res, cookies } = await callAction({ language: 'mr', baseline: 'beginner' });
    expect((res as { status: number; location: string }).status).toBe(303);
    expect((res as { location: string }).location).toBe('/library');
    expect(addUserLanguage).toHaveBeenCalledWith('u1', 'mr', 'beginner');
    expect(cookies.set).toHaveBeenCalledWith(
      'cia_lang',
      'mr',
      expect.objectContaining({ path: '/' }),
    );
  });

  it('defaults the baseline to none when omitted', async () => {
    await callAction({ language: 'or' });
    expect(addUserLanguage).toHaveBeenCalledWith('u1', 'or', 'none');
  });

  it('just switches (no add) when the language is already active', async () => {
    listUserLanguages.mockResolvedValue([{ language: 'hi' }, { language: 'mr' }]);
    const { res, cookies } = await callAction({ language: 'mr', baseline: 'intermediate' });
    expect(addUserLanguage).not.toHaveBeenCalled();
    expect(cookies.set).toHaveBeenCalledWith('cia_lang', 'mr', expect.any(Object));
    expect((res as { status: number }).status).toBe(303);
  });

  it('rejects an unsupported language with 400', async () => {
    const { res } = await callAction({ language: 'xx', baseline: 'none' });
    expect((res as { status: number }).status).toBe(400);
    expect(addUserLanguage).not.toHaveBeenCalled();
  });

  it('rejects an unknown baseline with 400', async () => {
    const { res } = await callAction({ language: 'mr', baseline: 'fluent' });
    expect((res as { status: number }).status).toBe(400);
    expect(addUserLanguage).not.toHaveBeenCalled();
  });

  it('bounces an anonymous submitter to /login', async () => {
    const { res } = await callAction({ language: 'mr', baseline: 'none' }, null);
    expect((res as { status: number; location: string }).status).toBe(303);
    expect((res as { location: string }).location).toContain('/login');
  });
});
