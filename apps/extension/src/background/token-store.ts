/**
 * Persisted auth tokens (storage.local).
 *
 * The interface lets the api-client be unit-tested against an in-memory store
 * without the browser. The concrete `tokenStore` is a thin storage binding
 * (excluded from coverage).
 */
import { ext } from '../shared/browser';

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  /** Cached for display ("logged in as …"); not used for auth. */
  email?: string;
};

export interface TokenStore {
  get(): Promise<AuthTokens | null>;
  set(tokens: AuthTokens): Promise<void>;
  clear(): Promise<void>;
}

const TOKENS_KEY = 'authTokens';

export const tokenStore: TokenStore = {
  async get() {
    const stored = await ext.storage.local.get(TOKENS_KEY);
    return (stored[TOKENS_KEY] as AuthTokens | undefined) ?? null;
  },
  async set(tokens) {
    await ext.storage.local.set({ [TOKENS_KEY]: tokens });
  },
  async clear() {
    await ext.storage.local.remove(TOKENS_KEY);
  },
};

/** Simple in-memory TokenStore — used by tests and as a reference impl. */
export function memoryTokenStore(initial: AuthTokens | null = null): TokenStore {
  let tokens = initial;
  return {
    get: async () => tokens,
    set: async (t) => {
      tokens = t;
    },
    clear: async () => {
      tokens = null;
    },
  };
}
