// @vitest-environment node
/**
 * Loader + action tests for /moderation/dictionary/sources (T-3.14).
 *
 * Mocks the admin-imports service to avoid filesystem and database
 * touches; the goal here is the routing surface — that the loader
 * gates non-admins and each action delegates to the right service
 * call with the triggering user's id attached.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listSourceStatuses = vi.fn();
const triggerFetch = vi.fn();
const triggerImport = vi.fn();
const deleteCache = vi.fn();

class JobAlreadyRunningError extends Error {
  constructor(public readonly slug: string) {
    super(`A job is already running for ${slug}`);
    this.name = 'JobAlreadyRunningError';
  }
}

vi.mock('$lib/server/dictionary/admin-imports.js', () => ({
  listSourceStatuses: (...a: unknown[]) => listSourceStatuses(...a),
  triggerFetch: (...a: unknown[]) => triggerFetch(...a),
  triggerImport: (...a: unknown[]) => triggerImport(...a),
  deleteCache: (...a: unknown[]) => deleteCache(...a),
  JobAlreadyRunningError,
}));

type Mod = typeof import('./+page.server.js');
const ADMIN = { id: 'admin-1', role: 'admin' as const };
const CURATOR = { id: 'cur-1', role: 'curator' as const };

async function callLoad(
  user: { id: string; role: 'admin' | 'curator' | 'user' } | null,
) {
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
  name: 'fetch' | 'import' | 'delete' | 'fetchAllMissing',
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
  try {
    return await actions[name]!(event);
  } catch (e) {
    return e;
  }
}

beforeEach(() => {
  listSourceStatuses.mockReset();
  triggerFetch.mockReset();
  triggerImport.mockReset();
  deleteCache.mockReset();
  listSourceStatuses.mockResolvedValue([]);
});

afterEach(() => {
  vi.resetModules();
});

describe('/moderation/dictionary/sources loader', () => {
  it('admins see the list of source rows', async () => {
    listSourceStatuses.mockResolvedValueOnce([
      { slug: 'kaikki-hindi', language: 'hi' },
    ]);
    const data = (await callLoad(ADMIN)) as { sources: { slug: string }[] };
    expect(data.sources).toHaveLength(1);
    expect(data.sources[0]!.slug).toBe('kaikki-hindi');
  });

  it('curators get a 403', async () => {
    const res = (await callLoad(CURATOR)) as { status: number };
    expect(res.status).toBe(403);
  });

  it('unauthenticated users are redirected to /login', async () => {
    const res = (await callLoad(null)) as { status: number; location?: string };
    expect(res.status).toBe(303);
    expect(res.location).toBe('/login?next=/moderation/dictionary/sources');
  });
});

describe('actions: fetch', () => {
  it('records the triggering admin id and returns ok', async () => {
    triggerFetch.mockReturnValueOnce({ status: 'running' });
    const res = (await callAction('fetch', { slug: 'kaikki-hindi' })) as {
      ok: boolean;
      slug: string;
    };
    expect(triggerFetch).toHaveBeenCalledWith('kaikki-hindi', {
      triggeredByUserId: ADMIN.id,
    });
    expect(res.ok).toBe(true);
    expect(res.slug).toBe('kaikki-hindi');
  });

  it('rejects non-admins with 403', async () => {
    const res = (await callAction('fetch', { slug: 'kaikki-hindi' }, CURATOR)) as {
      status: number;
    };
    expect(res.status).toBe(403);
    expect(triggerFetch).not.toHaveBeenCalled();
  });

  it('returns a 409 when a job is already running', async () => {
    triggerFetch.mockImplementationOnce(() => {
      throw new JobAlreadyRunningError('kaikki-hindi');
    });
    const res = (await callAction('fetch', { slug: 'kaikki-hindi' })) as {
      status: number;
      data: { ok: boolean; message: string };
    };
    expect(res.status).toBe(409);
    expect(res.data.ok).toBe(false);
    expect(res.data.message).toContain('already running');
  });

  it('400s when slug is missing', async () => {
    const res = (await callAction('fetch', {})) as { status: number };
    expect(res.status).toBe(400);
    expect(triggerFetch).not.toHaveBeenCalled();
  });
});

describe('actions: import', () => {
  it('passes the triggering admin id to the importer', async () => {
    triggerImport.mockReturnValueOnce({ status: 'running' });
    const res = (await callAction('import', { slug: 'kaikki-hindi' })) as {
      ok: boolean;
    };
    expect(triggerImport).toHaveBeenCalledWith('kaikki-hindi', {
      triggeredByUserId: ADMIN.id,
    });
    expect(res.ok).toBe(true);
  });

  it('rejects non-admins with 403', async () => {
    const res = (await callAction('import', { slug: 'x' }, CURATOR)) as {
      status: number;
    };
    expect(res.status).toBe(403);
  });
});

describe('actions: delete', () => {
  it('unlinks the cache and returns ok', async () => {
    deleteCache.mockResolvedValueOnce(undefined);
    const res = (await callAction('delete', { slug: 'kaikki-hindi' })) as {
      ok: boolean;
    };
    expect(deleteCache).toHaveBeenCalledWith('kaikki-hindi');
    expect(res.ok).toBe(true);
  });

  it('rejects non-admins', async () => {
    const res = (await callAction('delete', { slug: 'x' }, CURATOR)) as {
      status: number;
    };
    expect(res.status).toBe(403);
    expect(deleteCache).not.toHaveBeenCalled();
  });
});

describe('actions: fetchAllMissing', () => {
  it('triggers a fetch only for sources whose cache is missing', async () => {
    listSourceStatuses.mockResolvedValueOnce([
      { slug: 'a', cache: { state: 'cached' } },
      { slug: 'b', cache: { state: 'missing' } },
      { slug: 'c', cache: { state: 'partial' } },
      { slug: 'd', cache: { state: 'missing' } },
    ]);
    const res = (await callAction('fetchAllMissing', {})) as {
      ok: boolean;
      message: string;
    };
    expect(triggerFetch).toHaveBeenCalledTimes(2);
    expect(triggerFetch).toHaveBeenCalledWith('b', { triggeredByUserId: ADMIN.id });
    expect(triggerFetch).toHaveBeenCalledWith('d', { triggeredByUserId: ADMIN.id });
    expect(res.ok).toBe(true);
    expect(res.message).toContain('2 sources');
  });

  it('counts skipped slugs when a job is already running', async () => {
    listSourceStatuses.mockResolvedValueOnce([
      { slug: 'b', cache: { state: 'missing' } },
      { slug: 'd', cache: { state: 'missing' } },
    ]);
    triggerFetch.mockImplementationOnce(() => {
      throw new JobAlreadyRunningError('b');
    });
    const res = (await callAction('fetchAllMissing', {})) as {
      message: string;
    };
    expect(res.message).toContain('1 source');
    expect(res.message).toContain('1 already running');
  });

  it('rejects non-admins', async () => {
    const res = (await callAction('fetchAllMissing', {}, CURATOR)) as {
      status: number;
    };
    expect(res.status).toBe(403);
  });
});
