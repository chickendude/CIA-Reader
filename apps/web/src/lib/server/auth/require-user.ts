import { error, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { readSessionCookie, validateSessionToken } from './sessions.js';
import { verifyAccessToken } from './access-token.js';
import {
  PERSONAL_API_KEY_PREFIX,
  resolvePersonalApiKey,
} from './personal-api-keys.js';
import type { User } from '../db/schema.js';

/**
 * Resolve the authenticated user from either a bearer access token
 * (`Authorization: Bearer <jwt>`, mobile / API client) or a session cookie
 * (web UI). Bearer wins if both are present.
 *
 * Returns `null` when the caller is unauthenticated. Use `requireUser` to
 * throw a 401 instead.
 */
export async function resolveUser(event: RequestEvent): Promise<User | null> {
  const apiKeyHeader = event.request.headers.get('x-api-key');
  if (apiKeyHeader) {
    return await resolvePersonalApiKey(apiKeyHeader);
  }

  const authHeader = event.request.headers.get('authorization');
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice('bearer '.length).trim();
    if (token.startsWith(PERSONAL_API_KEY_PREFIX)) {
      return await resolvePersonalApiKey(token);
    }

    const payload = await verifyAccessToken(token);
    if (payload) {
      const [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, payload.sub))
        .limit(1);
      if (user) return user;
    }
    // A present-but-invalid bearer token never falls back to cookie auth —
    // that would mask broken clients.
    return null;
  }

  const cookieToken = readSessionCookie(event.cookies);
  if (!cookieToken) return null;
  const result = await validateSessionToken(cookieToken);
  return result?.user ?? null;
}

export async function requireUser(event: RequestEvent): Promise<User> {
  const user = event.locals.user ?? (await resolveUser(event));
  if (!user) throw error(401, 'Unauthorized');
  return user;
}
