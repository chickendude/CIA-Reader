/**
 * Login / logout / status against the CIA Reader auth endpoints.
 *
 * Login stores the access + refresh tokens; from then on the api-client attaches
 * the bearer and refreshes on 401. Logout just forgets the tokens locally.
 */
import { loadConfig } from '../shared/config';
import { tokenStore } from './token-store';

type AuthResponse = {
  user: { email: string };
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export type AuthStatus = { loggedIn: boolean; email?: string };

export async function login(email: string, password: string): Promise<AuthStatus & { error?: string }> {
  const { apiBaseUrl } = await loadConfig();
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch (e) {
    return { loggedIn: false, error: `Couldn't reach ${apiBaseUrl} (${e instanceof Error ? e.message : String(e)})` };
  }
  if (!res.ok) {
    return { loggedIn: false, error: `Login failed (HTTP ${res.status})` };
  }
  const data = (await res.json()) as AuthResponse;
  await tokenStore.set({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    email: data.user.email,
  });
  return { loggedIn: true, email: data.user.email };
}

export async function logout(): Promise<void> {
  await tokenStore.clear();
}

export async function authStatus(): Promise<AuthStatus> {
  const tokens = await tokenStore.get();
  return tokens ? { loggedIn: true, email: tokens.email } : { loggedIn: false };
}
