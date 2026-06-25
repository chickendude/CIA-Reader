// @vitest-environment node
/**
 * Route tests for /api/v1/me/languages: GET (the list + per-language
 * known-word counts read by the switcher) and POST (#436: add a
 * language to the user's list and switch to it in one request).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const upsertUserLanguage = vi.fn();
const listUserLanguages = vi.fn();
const withDefaultsForAllLanguages = vi.fn();
const knownLemmaCountsByLanguage = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/profile.js', () => ({
  upsertUserLanguage: (...a: unknown[]) => upsertUserLanguage(...a),
  listUserLanguages: (...a: unknown[]) => listUserLanguages(...a),
  withDefaultsForAllLanguages: (...a: unknown[]) =>
    withDefaultsForAllLanguages(...a),
}));

vi.mock('$lib/server/learning-stats.js', () => ({
  knownLemmaCountsByLanguage: (...a: unknown[]) =>
    knownLemmaCountsByLanguage(...a),
}));

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

type Post = (typeof import('./+server.js'))['POST'];
type Get = (typeof import('./+server.js'))['GET'];

async function callGet() {
  const { GET } = await import('./+server.js');
  const event = {
    locals: { user: { id: 'u1' } },
  } as unknown as Parameters<Get>[0];
  try {
    return (await GET(event)) as Response;
  } catch (e) {
    return e as { status: number };
  }
}

function makeCookies() {
  const set = vi.fn();
  return { set, get: vi.fn(), delete: vi.fn(), serialize: vi.fn() };
}

async function callPost(body: unknown, cookies = makeCookies()) {
  const { POST } = await import('./+server.js');
  const event = {
    locals: { user: { id: 'u1' } },
    cookies,
    request: new Request('http://x/api/v1/me/languages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as Parameters<Post>[0];
  try {
    return { res: (await POST(event)) as Response, cookies };
  } catch (e) {
    return { res: e as { status: number }, cookies };
  }
}

beforeEach(() => {
  upsertUserLanguage.mockReset();
  upsertUserLanguage.mockResolvedValue({ userId: 'u1', language: 'mr' });
  listUserLanguages.mockReset();
  listUserLanguages.mockResolvedValue([]);
  withDefaultsForAllLanguages.mockReset();
  knownLemmaCountsByLanguage.mockReset();
  knownLemmaCountsByLanguage.mockResolvedValue(new Map());
  requireUser.mockReset();
  requireUser.mockResolvedValue({ id: 'u1' });
});

afterEach(() => vi.resetModules());

describe('GET /api/v1/me/languages', () => {
  it('attaches the per-language known-lemma count from the grouped query', async () => {
    withDefaultsForAllLanguages.mockReturnValue([
      {
        code: 'hi',
        scriptPreference: 'native',
        romanizationScheme: 'iso15919',
        isDefault: false,
      },
      {
        code: 'mr',
        scriptPreference: 'native',
        romanizationScheme: 'iso15919',
        isDefault: true,
      },
    ]);
    // Only Hindi has known words; Marathi is absent from the map and
    // must surface as 0 rather than undefined.
    knownLemmaCountsByLanguage.mockResolvedValue(new Map([['hi', 42]]));

    const res = (await callGet()) as Response;
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      languages: Array<{ code: string; knownLemmaCount: number }>;
    };
    const byCode = Object.fromEntries(
      body.languages.map((l) => [l.code, l.knownLemmaCount]),
    );
    expect(byCode).toEqual({ hi: 42, mr: 0 });
    expect(knownLemmaCountsByLanguage).toHaveBeenCalledWith('u1');
  });

  it('401s an anonymous caller before touching the DB', async () => {
    requireUser.mockImplementation(() => {
      throw { status: 401 };
    });
    const res = (await callGet()) as { status: number };
    expect(res.status).toBe(401);
    expect(listUserLanguages).not.toHaveBeenCalled();
    expect(knownLemmaCountsByLanguage).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/me/languages', () => {
  it('adds the language with an empty patch and echoes the code', async () => {
    const { res } = await callPost({ code: 'mr' });
    expect((res as Response).status).toBe(200);
    expect(await (res as Response).json()).toEqual({ code: 'mr' });
    expect(upsertUserLanguage).toHaveBeenCalledWith('u1', 'mr', {});
  });

  it('sets the current-language cookie so add == switch', async () => {
    const { res, cookies } = await callPost({ code: 'mr' });
    expect((res as Response).status).toBe(200);
    expect(cookies.set).toHaveBeenCalledWith(
      'cia_lang',
      'mr',
      expect.objectContaining({ path: '/' }),
    );
  });

  it('rejects an unsupported language with 400 and writes nothing', async () => {
    const { res } = await callPost({ code: 'xx' });
    expect((res as { status: number }).status).toBe(400);
    expect(upsertUserLanguage).not.toHaveBeenCalled();
  });

  it('401s an anonymous caller before touching the DB', async () => {
    requireUser.mockImplementation(() => {
      throw { status: 401 };
    });
    const { res } = await callPost({ code: 'mr' });
    expect((res as { status: number }).status).toBe(401);
    expect(upsertUserLanguage).not.toHaveBeenCalled();
  });
});
