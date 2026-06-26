// @vitest-environment node
/**
 * Route tests for GET /api/v1/me/stats — per-language learning stats
 * for the Android stats screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getLanguageStats = vi.fn();
const languageComprehensionPct = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/learning-stats.js', () => ({
  getLanguageStats: (...a: unknown[]) => getLanguageStats(...a),
  languageComprehensionPct: (...a: unknown[]) => languageComprehensionPct(...a),
}));

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

type Get = (typeof import('./+server.js'))['GET'];

function makeCookies(get: () => string | undefined = () => undefined) {
  return { get, set: vi.fn(), delete: vi.fn(), serialize: vi.fn() };
}

async function callGet(
  search: string,
  cookies = makeCookies(),
): Promise<{ res: Response | { status: number }; cookies: ReturnType<typeof makeCookies> }> {
  const { GET } = await import('./+server.js');
  const event = {
    locals: { user: { id: 'u1' } },
    cookies,
    url: new URL(`http://x/api/v1/me/stats${search}`),
  } as unknown as Parameters<Get>[0];
  try {
    return { res: (await GET(event)) as Response, cookies };
  } catch (e) {
    return { res: e as { status: number }, cookies };
  }
}

beforeEach(() => {
  requireUser.mockReset();
  requireUser.mockResolvedValue({ id: 'u1' });
  getLanguageStats.mockReset();
  getLanguageStats.mockResolvedValue({
    knownCount: 42,
    learningCount: 7,
    ignoredCount: 1,
    encounteredCount: 100,
    knownPhrasesCount: 3,
    learningPhrasesCount: 2,
    ignoredPhrasesCount: 0,
    encounteredPhrasesCount: 10,
    listeningMinutes: 0,
  });
  languageComprehensionPct.mockReset();
  languageComprehensionPct.mockResolvedValue(63);
});

afterEach(() => vi.resetModules());

describe('GET /api/v1/me/stats', () => {
  it('returns counts + comprehension for the language query param', async () => {
    const { res } = await callGet('?language=hi');
    expect((res as Response).status).toBe(200);
    expect(await (res as Response).json()).toEqual({
      language: 'hi',
      knownCount: 42,
      learningCount: 7,
      encounteredCount: 100,
      knownPhrasesCount: 3,
      learningPhrasesCount: 2,
      estimatedComprehensionPct: 63,
    });
    expect(getLanguageStats).toHaveBeenCalledWith('u1', 'hi');
    expect(languageComprehensionPct).toHaveBeenCalledWith('u1', 'hi');
  });

  it('falls back to the cia_lang cookie when no param is given', async () => {
    const { res } = await callGet('', makeCookies(() => 'mr'));
    expect((res as Response).status).toBe(200);
    expect(getLanguageStats).toHaveBeenCalledWith('u1', 'mr');
  });

  it('passes through a null comprehension (no processed tokens yet)', async () => {
    languageComprehensionPct.mockResolvedValueOnce(null);
    const { res } = await callGet('?language=hi');
    const body = await (res as Response).json();
    expect(body.estimatedComprehensionPct).toBeNull();
  });

  it('rejects an unsupported language with 400', async () => {
    const { res } = await callGet('?language=zz');
    expect((res as { status: number }).status).toBe(400);
    expect(getLanguageStats).not.toHaveBeenCalled();
  });

  it('rejects with 400 when neither param nor cookie is present', async () => {
    const { res } = await callGet('');
    expect((res as { status: number }).status).toBe(400);
  });
});
