// @vitest-environment node
/**
 * Tests for /moderation/paradigms SSR loader + create action.
 *
 * The page is admin-only; this suite verifies the gate and that the
 * create action forwards a validated paradigm to the service, returning
 * a discriminated `section: 'create'` result.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listParadigms = vi.fn();
const createParadigm = vi.fn();

vi.mock('$lib/server/dictionary/paradigms.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/dictionary/paradigms.js')>(
    '$lib/server/dictionary/paradigms.js',
  );
  return {
    ...actual,
    listParadigms: (...a: unknown[]) => listParadigms(...a),
    createParadigm: (...a: unknown[]) => createParadigm(...a),
  };
});

type Mod = typeof import('./+page.server.js');
const ADMIN = { id: 'admin-1', role: 'admin' as const };
const CURATOR = { id: 'cur-1', role: 'curator' as const };

async function callLoad(
  user: { id: string; role: 'admin' | 'curator' | 'user' } | null,
  path = '/moderation/paradigms',
) {
  const { load } = (await import('./+page.server.js')) as Mod;
  const event = {
    locals: { user },
    url: new URL(`http://x${path}`),
  } as unknown as Parameters<Mod['load']>[0];
  try {
    return await load(event);
  } catch (e) {
    return e as { status?: number; location?: string };
  }
}

async function callCreate(
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
  return actions.create!(event);
}

beforeEach(() => {
  listParadigms.mockReset();
  createParadigm.mockReset();
  listParadigms.mockResolvedValue([]);
});

afterEach(() => {
  vi.resetModules();
});

describe('/moderation/paradigms loader', () => {
  it('admins see the list', async () => {
    listParadigms.mockResolvedValueOnce([
      { id: 'p1', language: 'or', pos: 'VERB', name: 'Odia regular verb' },
    ]);
    const data = (await callLoad(ADMIN)) as { paradigms: { id: string }[] };
    expect(data.paradigms).toHaveLength(1);
    expect(data.paradigms[0]!.id).toBe('p1');
    expect(listParadigms).toHaveBeenCalledWith({ language: null, pos: null });
  });

  it('passes language + pos filter through to the service', async () => {
    await callLoad(ADMIN, '/moderation/paradigms?language=hi&pos=NOUN');
    expect(listParadigms).toHaveBeenCalledWith({ language: 'hi', pos: 'NOUN' });
  });

  it('ignores an unsupported language code in the query', async () => {
    await callLoad(ADMIN, '/moderation/paradigms?language=xx');
    expect(listParadigms).toHaveBeenCalledWith({ language: null, pos: null });
  });

  it('curators get a 403', async () => {
    const res = (await callLoad(CURATOR)) as { status: number };
    expect(res.status).toBe(403);
    expect(listParadigms).not.toHaveBeenCalled();
  });

  it('unauthenticated visitors are redirected to /login', async () => {
    const res = (await callLoad(null)) as { status: number; location: string };
    expect(res.status).toBe(303);
    expect(res.location).toContain('/login');
    expect(res.location).toContain('next=');
  });
});

describe('?/create action', () => {
  it('forwards a validated paradigm and returns its id', async () => {
    createParadigm.mockResolvedValueOnce({ id: 'p99' });
    const result = (await callCreate({
      language: 'hi',
      pos: 'VERB',
      name: 'Hindi regular verb',
      description: 'For -ना infinitive verbs',
    })) as { ok: boolean; paradigmId: string };
    expect(result.ok).toBe(true);
    expect(result.paradigmId).toBe('p99');
    expect(createParadigm).toHaveBeenCalledWith({
      language: 'hi',
      pos: 'VERB',
      name: 'Hindi regular verb',
      description: 'For -ना infinitive verbs',
    });
  });

  it('returns a 400 fail when the name is missing', async () => {
    const result = (await callCreate({
      language: 'hi',
      pos: 'VERB',
    })) as { status: number; data: { ok: boolean; section: string } };
    expect(result.status).toBe(400);
    expect(result.data.section).toBe('create');
    expect(result.data.ok).toBe(false);
    expect(createParadigm).not.toHaveBeenCalled();
  });

  it('returns a 403 fail when a curator tries to create', async () => {
    const result = (await callCreate(
      { language: 'hi', pos: 'VERB', name: 'Test' },
      CURATOR,
    )) as { status: number; data: { ok: boolean; message: string } };
    expect(result.status).toBe(403);
    expect(result.data.ok).toBe(false);
    expect(createParadigm).not.toHaveBeenCalled();
  });
});
