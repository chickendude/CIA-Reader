import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { db, schema } from '$lib/server/db/index.js';
import { verifyPassword } from '$lib/server/auth/password.js';
import { createSession, setSessionCookie } from '$lib/server/auth/sessions.js';
import { signAccessToken, ACCESS_TOKEN_TTL } from '$lib/server/auth/access-token.js';
import { createRefreshToken } from '$lib/server/auth/refresh.js';
import { emailSchema, isSecureRequest, parseJson, publicUser } from '../_helpers.js';

const body = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
});

export const POST: RequestHandler = async ({ request, cookies, url }) => {
  const input = await parseJson(request, body);

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, input.email))
    .limit(1);

  // Constant-ish reply to avoid leaking whether the email is registered.
  const invalid = () => error(401, 'Invalid email or password');
  if (!user || !user.passwordHash) throw invalid();
  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) throw invalid();

  const session = await createSession(user.id);
  setSessionCookie(cookies, session.token, session.expiresAt, isSecureRequest(url));

  const accessToken = await signAccessToken(user.id);
  const refreshToken = await createRefreshToken(user.id);

  return json({
    user: publicUser(user),
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL,
  });
};
