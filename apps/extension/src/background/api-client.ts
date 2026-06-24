/**
 * Authenticated API client for the CIA Reader backend.
 *
 * Mirrors the Android client's interceptor + authenticator pair: attach the
 * bearer access token, and on a 401 refresh once (with a single shared in-flight
 * refresh so concurrent calls don't stampede), retry, and clear the tokens if the
 * refresh itself fails. Dependencies are injected so the refresh state machine is
 * unit-testable without the browser.
 */
import { loadConfig } from '../shared/config';
import { tokenStore, type AuthTokens, type TokenStore } from './token-store';

export type ApiClientDeps = {
  store: TokenStore;
  getBaseUrl: () => Promise<string>;
  fetchImpl?: typeof fetch;
};

type RefreshResponse = { accessToken: string; refreshToken?: string };

export function createApiClient(deps: ApiClientDeps) {
  const doFetch = deps.fetchImpl ?? fetch;
  let refreshing: Promise<AuthTokens | null> | null = null;

  function refresh(current: AuthTokens): Promise<AuthTokens | null> {
    // Collapse concurrent refreshes into one in-flight request.
    refreshing ??= (async () => {
      const base = await deps.getBaseUrl();
      const res = await doFetch(`${base}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });
      if (!res.ok) {
        await deps.store.clear();
        return null;
      }
      const data = (await res.json()) as RefreshResponse;
      const next: AuthTokens = {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken ?? current.refreshToken,
        email: current.email,
      };
      await deps.store.set(next);
      return next;
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const base = await deps.getBaseUrl();
    const tokens = await deps.store.get();

    const send = (t: AuthTokens | null) =>
      doFetch(`${base}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(init.headers as Record<string, string> | undefined),
          ...(t ? { authorization: `Bearer ${t.accessToken}` } : {}),
        },
      });

    let res = await send(tokens);
    if (res.status === 401 && tokens?.refreshToken) {
      const next = await refresh(tokens);
      if (next) res = await send(next);
    }
    return res;
  }

  async function getJson<T>(path: string): Promise<T> {
    const res = await request(path);
    if (!res.ok) throw new Error(`GET ${path} failed: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  async function postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await request(path, { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`POST ${path} failed: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  return { request, getJson, postJson };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Singleton bound to the persisted tokens + configured backend URL. */
export const api: ApiClient = createApiClient({
  store: tokenStore,
  getBaseUrl: async () => (await loadConfig()).apiBaseUrl,
});
