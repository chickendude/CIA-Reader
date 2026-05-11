import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { db, schema } from '$lib/server/db/index.js';
import { hashPassword } from '$lib/server/auth/password.js';
import { createMagicLink } from '$lib/server/auth/magic-link.js';
import { createSession, setSessionCookie } from '$lib/server/auth/sessions.js';
import { signAccessToken, ACCESS_TOKEN_TTL } from '$lib/server/auth/access-token.js';
import { createRefreshToken } from '$lib/server/auth/refresh.js';
import { buildMagicLinkEmail, sendMail } from '$lib/server/email/index.js';
import { APP_BASE_URL } from '$lib/server/env.js';
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

  // Send a verification magic-link (T-11.7). Same handler as
  // /login's "Email me a link" — the consumer in
  // $lib/server/auth/magic-link.ts sets email_verified_at on
  // click, so this email both welcomes and verifies. Failures
  // are logged but don't block signup — clients can resend via
  // POST /api/v1/auth/verify-email/resend.
  try {
    const token = await createMagicLink(created.id);
    const verifyUrl = `${APP_BASE_URL}/auth/magic/${encodeURIComponent(token)}`;
    await sendMail(buildMagicLinkEmail(created.email, verifyUrl));
  } catch (err) {
    console.error('Failed to send verification email on register:', err);
  }

  const accessToken = await signAccessToken(created.id);
  const refreshToken = await createRefreshToken(created.id);

  return json({
    user: publicUser(created),
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL,
  });
};
