import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { db, schema } from '$lib/server/db/index.js';
import { hashPassword } from '$lib/server/auth/password.js';
import { createSession, setSessionCookie } from '$lib/server/auth/sessions.js';
import { signAccessToken, ACCESS_TOKEN_TTL } from '$lib/server/auth/access-token.js';
import { createRefreshToken } from '$lib/server/auth/refresh.js';
import { emailSchema, isSecureRequest, parseJson, passwordSchema, publicUser } from '../_helpers.js';

const body = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(80).optional(),
});

export const POST: RequestHandler = async ({ request, cookies, url }) => {
  const input = await parseJson(request, body);

  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, input.email))
    .limit(1);
  if (existing) throw error(409, 'An account with that email already exists');

  const passwordHash = await hashPassword(input.password);

  const [created] = await db
    .insert(schema.users)
    .values({
      email: input.email,
      passwordHash,
      displayName: input.displayName ?? null,
    })
    .returning();
  if (!created) throw error(500, 'Failed to create user');

  const session = await createSession(created.id);
  setSessionCookie(cookies, session.token, session.expiresAt, isSecureRequest(url));

  const accessToken = await signAccessToken(created.id);
  const refreshToken = await createRefreshToken(created.id);

  return json({
    user: publicUser(created),
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL,
  });
};
