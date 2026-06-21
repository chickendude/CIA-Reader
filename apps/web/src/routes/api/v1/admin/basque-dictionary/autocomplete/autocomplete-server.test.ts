// @vitest-environment node
/**
 * Route tests for GET /api/v1/admin/basque-dictionary/autocomplete.
 * The Elhuyar autocomplete fetch is mocked so these exercise the auth gate +
 * parameter handling without the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const searchElhuyarAutocomplete = vi.fn();

vi.mock('$lib/server/dictionary/basque-reference.js', async () => {
  const actual = await vi.importActual<
    typeof import('$lib/server/dictionary/basque-reference.js')
  >('$lib/server/dictionary/basque-reference.js');
  return {
    ...actual,
    searchElhuyarAutocomplete: (...a: unknown[]) => searchElhuyarAutocomplete(...a),
  };
});

type Get = (typeof import('./+server.js'))['GET'];
type User = { id: string; role: 'user' | 'curator' | 'admin' } | null;

async function callGet(query: string, user: User) {
  const { GET } = await import('./+server.js');
  const event = {
    locals: { user },
    url: new URL(`http://x/api/v1/admin/basque-dictionary/autocomplete${query}`),
  } as unknown as Parameters<Get>[0];
  try {
    return await GET(event);
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  searchElhuyarAutocomplete.mockReset();
  searchElhuyarAutocomplete.mockResolvedValue(['Afrika', 'Afrika Erdiko Errepublika', 'afrikaans']);
});
afterEach(() => vi.resetModules());

describe('GET /api/v1/admin/basque-dictionary/autocomplete', () => {
  it('401s when unauthenticated', async () => {
    const res = (await callGet('?term=afrika', null)) as { status: number };
    expect(res.status).toBe(401);
    expect(searchElhuyarAutocomplete).not.toHaveBeenCalled();
  });

  it('403s for a non-admin', async () => {
    const res = (await callGet('?term=afrika', { id: 'u', role: 'curator' })) as {
      status: number;
    };
    expect(res.status).toBe(403);
    expect(searchElhuyarAutocomplete).not.toHaveBeenCalled();
  });

  it('returns autocomplete terms for an admin', async () => {
    const res = (await callGet('?term=afrika', { id: 'a', role: 'admin' })) as Response;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.terms).toEqual(['Afrika', 'Afrika Erdiko Errepublika', 'afrikaans']);
    expect(searchElhuyarAutocomplete).toHaveBeenCalledWith('afrika');
  });

  it('returns an empty list for a blank term without calling upstream', async () => {
    const res = (await callGet('?term=', { id: 'a', role: 'admin' })) as Response;
    expect(res.status).toBe(200);
    expect((await res.json()).terms).toEqual([]);
    expect(searchElhuyarAutocomplete).not.toHaveBeenCalled();
  });

  it('degrades to an empty list when upstream throws', async () => {
    searchElhuyarAutocomplete.mockRejectedValueOnce(new Error('upstream down'));
    const res = (await callGet('?term=afrika', { id: 'a', role: 'admin' })) as Response;
    expect(res.status).toBe(200);
    expect((await res.json()).terms).toEqual([]);
  });
});
