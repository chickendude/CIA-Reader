// @vitest-environment node
/**
 * Route tests for PATCH /api/v1/me/languages/:code (T-5.1b extends).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const upsertUserLanguage = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/profile.js', () => ({
  upsertUserLanguage: (...a: unknown[]) => upsertUserLanguage(...a),
}));

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

type Patch = (typeof import('./+server.js'))['PATCH'];

async function callPatch(code: string, body: unknown) {
  const { PATCH } = await import('./+server.js');
  const event = {
    params: { code },
    locals: { user: { id: 'u1' } },
    request: new Request('http://x/api/v1/me/languages/' + code, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as Parameters<Patch>[0];
  try {
    return (await PATCH(event)) as Response;
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  upsertUserLanguage.mockReset();
  upsertUserLanguage.mockImplementation(async (_id, code, patch) => ({
    userId: 'u1',
    language: code,
    ...patch,
  }));
  requireUser.mockReset();
  requireUser.mockResolvedValue({ id: 'u1' });
});

afterEach(() => vi.resetModules());

describe('PATCH /api/v1/me/languages/:code', () => {
  it('accepts a reader-settings patch with multiple fields', async () => {
    const res = (await callPatch('hi', {
      readerLayoutMode: 'continuous',
      fontSize: 22,
      lineSpacing: 1.8,
      readingWidth: 'wide',
      highlightStyle: 'underline',
      wordsPerPage: 300,
    })) as Response;
    expect(res.status).toBe(200);
    expect(upsertUserLanguage).toHaveBeenCalledWith(
      'u1',
      'hi',
      expect.objectContaining({
        readerLayoutMode: 'continuous',
        fontSize: 22,
        readingWidth: 'wide',
      }),
    );
  });

  it('accepts a fontFamily=null patch (= revert to system default)', async () => {
    const res = (await callPatch('hi', { fontFamily: null })) as Response;
    expect(res.status).toBe(200);
    expect(upsertUserLanguage).toHaveBeenCalledWith(
      'u1',
      'hi',
      expect.objectContaining({ fontFamily: null }),
    );
  });

  it('rejects an out-of-range fontSize with 400', async () => {
    const res = (await callPatch('hi', { fontSize: 99 })) as { status: number };
    expect(res.status).toBe(400);
    expect(upsertUserLanguage).not.toHaveBeenCalled();
  });

  it('rejects an empty body with 400', async () => {
    const res = (await callPatch('hi', {})) as { status: number };
    expect(res.status).toBe(400);
    expect(upsertUserLanguage).not.toHaveBeenCalled();
  });

  it('still accepts the legacy scriptPreference + romanizationScheme fields', async () => {
    const res = (await callPatch('hi', {
      scriptPreference: 'native_with_romanization',
      romanizationScheme: 'iast',
    })) as Response;
    expect(res.status).toBe(200);
  });

  it('400s when romanization scheme is unsupported for the language', async () => {
    // Odia (or) does not support hunterian per the registry.
    const res = (await callPatch('or', {
      romanizationScheme: 'hunterian',
    })) as { status: number };
    expect(res.status).toBe(400);
    expect(upsertUserLanguage).not.toHaveBeenCalled();
  });
});
