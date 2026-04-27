// @vitest-environment node
/**
 * Tests for /moderation/+layout.server.ts guard (T-3.7).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listGrantedLanguages = vi.fn();

vi.mock('$lib/server/dictionary/permissions.js', async () => {
  const actual = await vi.importActual<
    typeof import('$lib/server/dictionary/permissions.js')
  >('$lib/server/dictionary/permissions.js');
  return {
    ...actual,
    listGrantedLanguages: (...a: unknown[]) => listGrantedLanguages(...a),
  };
});

type LoadFn = (typeof import('./+layout.server.js'))['load'];
type LoadEvent = Parameters<LoadFn>[0];

async function callLoad(
  user: { id: string; role: string } | null,
  path = '/moderation/dictionary',
) {
  const { load } = await import('./+layout.server.js');
  const event = {
    locals: { user },
    url: new URL(`http://x${path}`),
  } as unknown as LoadEvent;
  try {
    return await load(event);
  } catch (e) {
    return e as { status?: number; location?: string };
  }
}

beforeEach(() => {
  listGrantedLanguages.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('/moderation layout guard', () => {
  it('redirects an unauthenticated visitor to the login page', async () => {
    const res = (await callLoad(null)) as { status: number; location: string };
    expect(res.status).toBe(303);
    expect(res.location).toContain('/login');
    expect(res.location).toContain('next=');
  });

  it('forbids a regular user role', async () => {
    const res = (await callLoad({ id: 'u1', role: 'user' })) as { status: number };
    expect(res.status).toBe(403);
    expect(listGrantedLanguages).not.toHaveBeenCalled();
  });

  it('returns granted languages for a curator', async () => {
    listGrantedLanguages.mockResolvedValueOnce(['hi', 'mr']);
    const data = (await callLoad({ id: 'c1', role: 'curator' })) as {
      moderator: { grantedLanguages: string[]; role: string };
    };
    expect(data.moderator.role).toBe('curator');
    expect(data.moderator.grantedLanguages).toEqual(['hi', 'mr']);
  });

  it('returns all MVP languages for an admin', async () => {
    listGrantedLanguages.mockResolvedValueOnce(['hi', 'mr', 'or']);
    const data = (await callLoad({ id: 'a1', role: 'admin' })) as {
      moderator: { grantedLanguages: string[]; role: string };
    };
    expect(data.moderator.role).toBe('admin');
    expect(data.moderator.grantedLanguages).toEqual(['hi', 'mr', 'or']);
  });
});
