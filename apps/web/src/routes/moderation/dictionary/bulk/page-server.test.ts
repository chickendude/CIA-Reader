// @vitest-environment node
/**
 * Tests for /moderation/dictionary/bulk SSR loader + actions (T-3.9).
 *
 * The page is admin-only; this suite verifies the loader gate plus that
 * each action correctly delegates to the bulk service and shapes the
 * result by `section`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bulkImportTranslations = vi.fn();
const bulkPromoteTranslations = vi.fn();
const bulkUpdateAttribution = vi.fn();

vi.mock('$lib/server/dictionary/bulk.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/dictionary/bulk.js')>(
    '$lib/server/dictionary/bulk.js',
  );
  return {
    ...actual,
    bulkImportTranslations: (...a: unknown[]) => bulkImportTranslations(...a),
    bulkPromoteTranslations: (...a: unknown[]) => bulkPromoteTranslations(...a),
    bulkUpdateAttribution: (...a: unknown[]) => bulkUpdateAttribution(...a),
  };
});

type Mod = typeof import('./+page.server.js');
const ADMIN = { id: 'admin-1', role: 'admin' as const };
const CURATOR = { id: 'cur-1', role: 'curator' as const };

async function callLoad(user: { id: string; role: 'admin' | 'curator' | 'user' } | null) {
  const { load } = (await import('./+page.server.js')) as Mod;
  const event = {
    locals: { user },
  } as unknown as Parameters<Mod['load']>[0];
  try {
    return await load(event);
  } catch (e) {
    return e as { status?: number; location?: string };
  }
}

async function callAction(
  name: 'import' | 'promote' | 'attribution',
  fields: Record<string, string>,
  user: { id: string; role: 'admin' | 'curator' | 'user' } | null = ADMIN,
) {
  const { actions } = (await import('./+page.server.js')) as Mod;
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const event = {
    locals: { user },
    request: {
      formData: () => Promise.resolve(fd),
    } as unknown as Request,
  } as unknown as Parameters<Mod['actions'][string]>[0];
  return actions[name]!(event);
}

beforeEach(() => {
  bulkImportTranslations.mockReset();
  bulkPromoteTranslations.mockReset();
  bulkUpdateAttribution.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('/moderation/dictionary/bulk loader', () => {
  it('admins see the bulk page', async () => {
    const data = (await callLoad(ADMIN)) as { bulkLimit: number };
    expect(data.bulkLimit).toBeGreaterThan(0);
  });

  it('curators get a 403', async () => {
    const res = (await callLoad(CURATOR)) as { status: number };
    expect(res.status).toBe(403);
  });

  it('unauthenticated visitors are redirected to /login', async () => {
    const res = (await callLoad(null)) as { status: number; location: string };
    expect(res.status).toBe(303);
    expect(res.location).toContain('/login');
  });
});

describe('?/import action', () => {
  it('parses tab-separated rows and forwards them to the service', async () => {
    bulkImportTranslations.mockResolvedValueOnce({ inserted: 2, skipped: [] });
    const result = (await callAction('import', {
      csv: 'hi\tबोलना\tverb\tto speak\nhi\tसोना\tnoun\tgold',
      reason: 'Importing curator gloss CSV',
    })) as { ok: boolean; inserted: number };
    expect(result.ok).toBe(true);
    expect(result.inserted).toBe(2);
    expect(bulkImportTranslations).toHaveBeenCalledWith(
      ADMIN,
      [
        { language: 'hi', headword: 'बोलना', pos: 'verb', body: 'to speak' },
        { language: 'hi', headword: 'सोना', pos: 'noun', body: 'gold' },
      ],
      'Importing curator gloss CSV',
      {},
    );
  });

  it('skips comment lines and empty lines', async () => {
    bulkImportTranslations.mockResolvedValueOnce({ inserted: 1, skipped: [] });
    await callAction('import', {
      csv: '# header\n\nhi,बोलना,verb,to speak\n',
      reason: 'with comments',
    });
    expect(bulkImportTranslations).toHaveBeenCalledWith(
      ADMIN,
      [{ language: 'hi', headword: 'बोलना', pos: 'verb', body: 'to speak' }],
      'with comments',
      {},
    );
  });

  it('forwards a default attribution when supplied', async () => {
    bulkImportTranslations.mockResolvedValueOnce({ inserted: 1, skipped: [] });
    await callAction('import', {
      csv: 'hi,बोलना,verb,to speak',
      reason: 'with default',
      defaultAttribution: 'CIA Reader curators',
    });
    expect(bulkImportTranslations).toHaveBeenCalledWith(
      ADMIN,
      expect.any(Array),
      'with default',
      { sourceAttribution: 'CIA Reader curators' },
    );
  });

  it('returns a fail() with section=import when the CSV is empty', async () => {
    const result = (await callAction('import', {
      csv: '   ',
      reason: 'whitespace',
    })) as { status: number; data: { ok: boolean; section: string } };
    expect(result.status).toBe(400);
    expect(result.data.section).toBe('import');
    expect(result.data.ok).toBe(false);
  });
});

describe('?/promote action', () => {
  const VALID_ID_1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const VALID_ID_2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  it('parses newline / comma / whitespace and forwards UUIDs', async () => {
    bulkPromoteTranslations.mockResolvedValueOnce({ promoted: 2, skipped: [] });
    const result = (await callAction('promote', {
      ids: `${VALID_ID_1}, ${VALID_ID_2}\nnot-a-uuid`,
      reason: 'Endorsing community',
    })) as { ok: boolean; promoted: number };
    expect(result.ok).toBe(true);
    expect(result.promoted).toBe(2);
    expect(bulkPromoteTranslations).toHaveBeenCalledWith(
      ADMIN,
      [VALID_ID_1, VALID_ID_2],
      'Endorsing community',
    );
  });

  it('returns a fail when no UUIDs are present', async () => {
    const result = (await callAction('promote', {
      ids: 'foo bar baz',
      reason: 'forced',
    })) as { status: number; data: { ok: boolean; section: string } };
    expect(result.status).toBe(400);
    expect(result.data.section).toBe('promote');
  });
});

describe('?/attribution action', () => {
  it('forwards the attribution change with optional language scope', async () => {
    bulkUpdateAttribution.mockResolvedValueOnce({ updated: 5 });
    const result = (await callAction('attribution', {
      source: 'official_dictionary',
      oldAttribution: 'Hindi WordNet',
      newAttribution: 'Hindi WordNet (CFILT, IIT-Bombay)',
      language: 'hi',
      reason: 'Add full attribution to imported rows',
    })) as { ok: boolean; updated: number };
    expect(result.ok).toBe(true);
    expect(result.updated).toBe(5);
    expect(bulkUpdateAttribution).toHaveBeenCalledWith(
      ADMIN,
      {
        source: 'official_dictionary',
        oldAttribution: 'Hindi WordNet',
        newAttribution: 'Hindi WordNet (CFILT, IIT-Bombay)',
        language: 'hi',
      },
      'Add full attribution to imported rows',
    );
  });

  it('clears attribution when the clearAttribution checkbox is on', async () => {
    bulkUpdateAttribution.mockResolvedValueOnce({ updated: 3 });
    await callAction('attribution', {
      source: 'curator',
      oldAttribution: 'stale',
      newAttribution: 'will-be-ignored',
      clearAttribution: 'true',
      reason: 'Clearing stale attribution',
    });
    const args = bulkUpdateAttribution.mock.calls[0]!;
    expect(args[1]).toMatchObject({ newAttribution: null });
  });

  it('rejects an unsupported language code with 400', async () => {
    const result = (await callAction('attribution', {
      source: 'official_dictionary',
      oldAttribution: 'Old',
      newAttribution: 'New',
      language: 'xx',
      reason: 'forced',
    })) as { status: number; data: { ok: boolean; section: string } };
    expect(result.status).toBe(400);
    expect(result.data.section).toBe('attribution');
  });
});
