import { describe, expect, it, vi } from 'vitest';

import { createApiClient } from './api-client';
import { memoryTokenStore, type AuthTokens } from './token-store';

const BASE = 'http://localhost:5173';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const tokens = (over: Partial<AuthTokens> = {}): AuthTokens => ({
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  email: 'me@test.local',
  ...over,
});

describe('createApiClient', () => {
  it('attaches the bearer access token', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true }));
    const api = createApiClient({
      store: memoryTokenStore(tokens()),
      getBaseUrl: async () => BASE,
      fetchImpl,
    });

    await api.getJson('/api/v1/auth/me');

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(`${BASE}/api/v1/auth/me`);
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer access-1');
  });

  it('refreshes once on 401, persists the new tokens, and retries', async () => {
    const store = memoryTokenStore(tokens());
    const fetchImpl = vi
      .fn<typeof fetch>()
      // first protected call → 401
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      // refresh → new tokens
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'access-2', refreshToken: 'refresh-2' }))
      // retry → success
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const api = createApiClient({ store, getBaseUrl: async () => BASE, fetchImpl });
    const out = await api.getJson<{ ok: boolean }>('/api/v1/protected');

    expect(out.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    // refresh hit the right endpoint with the old refresh token
    const [refreshUrl, refreshInit] = fetchImpl.mock.calls[1]!;
    expect(String(refreshUrl)).toBe(`${BASE}/api/v1/auth/refresh`);
    expect(JSON.parse(String(refreshInit?.body))).toEqual({ refreshToken: 'refresh-1' });

    // retry used the refreshed access token
    const retryInit = fetchImpl.mock.calls[2]![1];
    expect((retryInit?.headers as Record<string, string>).authorization).toBe('Bearer access-2');

    // store now holds the rotated tokens
    expect(await store.get()).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-2' });
  });

  it('clears the tokens when the refresh itself fails', async () => {
    const store = memoryTokenStore(tokens());
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response('nope', { status: 401 }));

    const api = createApiClient({ store, getBaseUrl: async () => BASE, fetchImpl });
    const res = await api.request('/api/v1/protected');

    expect(res.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // no retry after a failed refresh
    expect(await store.get()).toBeNull();
  });

  it('collapses concurrent 401s into a single refresh', async () => {
    const store = memoryTokenStore(tokens());
    let refreshCount = 0;
    // First attempt for each call (Bearer access-1) is unauthorized; the retry
    // (Bearer access-2, after the shared refresh) succeeds.
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.endsWith('/api/v1/auth/refresh')) {
        refreshCount += 1;
        return jsonResponse({ accessToken: 'access-2', refreshToken: 'refresh-2' });
      }
      const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
      return auth === 'Bearer access-2'
        ? jsonResponse({ ok: true })
        : new Response('unauthorized', { status: 401 });
    });

    const api = createApiClient({ store, getBaseUrl: async () => BASE, fetchImpl });
    const results = await Promise.all([
      api.getJson<{ ok: boolean }>('/a'),
      api.getJson<{ ok: boolean }>('/b'),
      api.getJson<{ ok: boolean }>('/c'),
    ]);

    expect(results.every((r) => r.ok)).toBe(true);
    expect(refreshCount).toBe(1);
  });
});
