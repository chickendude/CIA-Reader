// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requireUser = vi.fn();
const getVocabularyForExport = vi.fn();

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

vi.mock('$lib/server/vocabulary.js', async () => {
  const actual = await vi.importActual<
    typeof import('$lib/server/vocabulary.js')
  >('$lib/server/vocabulary.js');
  return {
    ...actual,
    getVocabularyForExport: (...a: unknown[]) =>
      getVocabularyForExport(...a),
  };
});

type GetFn = (typeof import('./+server.js'))['GET'];

async function callGet(url = 'http://x/api/v1/me/vocabulary/export?language=hi') {
  const { GET } = await import('./+server.js');
  const event = {
    url: new URL(url),
    request: new Request(url),
  } as unknown as Parameters<GetFn>[0];
  try {
    return (await GET(event)) as Response;
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  requireUser.mockReset();
  requireUser.mockResolvedValue({ id: 'u1' });
  getVocabularyForExport.mockReset();
  getVocabularyForExport.mockResolvedValue([]);
});

afterEach(() => {
  vi.resetModules();
});

describe('GET /api/v1/me/vocabulary/export', () => {
  it('returns a CSV attachment for the requested language', async () => {
    getVocabularyForExport.mockResolvedValueOnce([
      {
        headword: 'बोलना',
        pos: 'VERB',
        gloss: 'to speak',
        status: 'known',
      },
    ]);

    const res = (await callGet()) as Response;

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain(
      'ciareader-vocabulary-hi.csv',
    );
    expect(await res.text()).toBe(
      'headword,pos,gloss,status\nबोलना,VERB,to speak,known\n',
    );
    expect(getVocabularyForExport).toHaveBeenCalledWith('u1', 'hi');
  });

  it('rejects a missing language with 400', async () => {
    const res = (await callGet(
      'http://x/api/v1/me/vocabulary/export',
    )) as { status: number };

    expect(res.status).toBe(400);
    expect(getVocabularyForExport).not.toHaveBeenCalled();
  });

  it('rejects an unsupported language with 400', async () => {
    const res = (await callGet(
      'http://x/api/v1/me/vocabulary/export?language=fr',
    )) as { status: number };

    expect(res.status).toBe(400);
    expect(getVocabularyForExport).not.toHaveBeenCalled();
  });

  it('requires auth', async () => {
    requireUser.mockImplementationOnce(() => {
      throw { status: 401 };
    });

    const res = (await callGet()) as { status: number };

    expect(res.status).toBe(401);
    expect(getVocabularyForExport).not.toHaveBeenCalled();
  });
});
