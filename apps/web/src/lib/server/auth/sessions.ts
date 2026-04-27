import { and, eq, gt } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import { db, schema } from '../db/index.js';
import { generateToken, hashToken } from './tokens.js';
import type { User } from '../db/schema.js';

const SESSION_COOKIE = 'cia_session';
const SESSION_TTL_DAYS = 30;

function ttlMs() {
  return SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const id = hashToken(token);
  const expiresAt = new Date(Date.now() + ttlMs());
  await db.insert(schema.sessions).values({ id, userId, expiresAt });
  return { token, expiresAt };
}

export async function validateSessionToken(
  token: string,
): Promise<{ user: User } | null> {
  const id = hashToken(token);
  const [row] = await db
    .select({ session: schema.sessions, user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  return { user: row.user };
}

export async function invalidateSession(token: string): Promise<void> {
  const id = hashToken(token);
  await db.delete(schema.sessions).where(eq(schema.sessions.id, id));
}

export function setSessionCookie(
  cookies: Cookies,
  token: string,
  expiresAt: Date,
  isSecure: boolean,
) {
  cookies.set(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    expires: expiresAt,
  });
}

export function clearSessionCookie(cookies: Cookies, isSecure: boolean) {
  cookies.delete(SESSION_COOKIE, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
  });
}

export function readSessionCookie(cookies: Cookies): string | undefined {
  return cookies.get(SESSION_COOKIE);
}

export { SESSION_COOKIE };
