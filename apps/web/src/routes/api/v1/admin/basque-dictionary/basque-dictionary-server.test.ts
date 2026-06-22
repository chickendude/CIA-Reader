// @vitest-environment node
/**
 * Route tests for GET /api/v1/admin/basque-dictionary.
 *
 * The lookup module is mocked so these exercise the endpoint's auth gate +
 * parameter handling without touching the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lookupBasqueReference = vi.fn();

vi.mock('$lib/server/dictionary/basque-reference.js', async () => {
  const actual = await vi.importActual<
    typeof import('$lib/server/dictionary/basque-reference.js')
  >('$lib/server/dictionary/basque-reference.js');
  return {
    ...actual,
    lookupBasqueReference: (...a: unknown[]) => lookupBasqueReference(...a),
  };
});

type Get = (typeof import('./+server.js'))['GET'];
type User = { id: string; role: 'user' | 'curator' | 'admin' } | null;

async function callGet(query: string, user: User) {
  const { GET } = await import('./+server.js');
  const event = {
    locals: { user },
    url: new URL(`http://x/api/v1/admin/basque-dictionary${query}`),
  } as unknown as Parameters<Get>[0];
  try {
    return await GET(event);
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  lookupBasqueReference.mockReset();
  lookupBasqueReference.mockResolvedValue([
    {
      source: 'elhuyar_es',
      label: 'Elhuyar eu-es',
      headword: 'etxe',
      pos: 'iz.',
      definition: 'casa',
      examples: [],
      url: 'https://hiztegiak.elhuyar.eus/eu/etxe',
    },
  ]);
});

afterEach(() => {
  vi.resetModules();
});

describe('GET /api/v1/admin/basque-dictionary', () => {
  it('401s when unauthenticated', async () => {
    const res = (await callGet('?word=etxe', null)) as { status: number };
    expect(res.status).toBe(401);
    expect(lookupBasqueReference).not.toHaveBeenCalled();
  });

  it('403s for a non-admin user', async () => {
    const res = (await callGet('?word=etxe', { id: 'u1', role: 'curator' })) as {
      status: number;
    };
    expect(res.status).toBe(403);
    expect(lookupBasqueReference).not.toHaveBeenCalled();
  });

  it('400s when the word is missing', async () => {
    const res = (await callGet('', { id: 'a', role: 'admin' })) as { status: number };
    expect(res.status).toBe(400);
  });

  it('returns parsed results for an admin and defaults to all sources', async () => {
    const res = (await callGet('?word=etxe', { id: 'a', role: 'admin' })) as Response;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.word).toBe('etxe');
    expect(body.results[0].definition).toBe('casa');
    expect(lookupBasqueReference).toHaveBeenCalledWith(
      'etxe',
      ['elhuyar_es', 'elhuyar_en', 'euskaltzaindia'],
      expect.objectContaining({ cache: expect.anything() }),
    );
  });

  it('filters the sources param to the known set', async () => {
    await callGet('?word=etxe&sources=elhuyar_en,bogus', { id: 'a', role: 'admin' });
    expect(lookupBasqueReference).toHaveBeenCalledWith(
      'etxe',
      ['elhuyar_en'],
      expect.objectContaining({ cache: expect.anything() }),
    );
  });

  it('passes preserveCase=true only when exact=1', async () => {
    await callGet('?word=Afrika&exact=1', { id: 'a', role: 'admin' });
    expect(lookupBasqueReference).toHaveBeenCalledWith(
      'Afrika',
      expect.anything(),
      expect.objectContaining({ preserveCase: true }),
    );
    lookupBasqueReference.mockClear();
    await callGet('?word=Afrika', { id: 'a', role: 'admin' });
    expect(lookupBasqueReference).toHaveBeenCalledWith(
      'Afrika',
      expect.anything(),
      expect.objectContaining({ preserveCase: false }),
    );
  });

  it('400s when the sources param has no valid entries', async () => {
    const res = (await callGet('?word=etxe&sources=bogus', {
      id: 'a',
      role: 'admin',
    })) as { status: number };
    expect(res.status).toBe(400);
  });
});
