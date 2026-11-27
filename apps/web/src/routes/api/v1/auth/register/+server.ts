import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { registerAccount } from '$lib/server/auth/password-access.js';
import { sendAccountLink } from '$lib/server/email/account-link.js';
import { createSession, setSessionCookie } from '$lib/server/auth/sessions.js';
import { signAccessToken, ACCESS_TOKEN_TTL } from '$lib/server/auth/access-token.js';
import { createRefreshToken } from '$lib/server/auth/refresh.js';
import { emailSchema, isSecureRequest, parseJson, passwordSchema, publicUser } from '../_helpers.js';

const body = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(80).optional(),
});

export const POST: RequestHandler = async ({ request, cookies, url, getClientAddress }) => {
  const input = await parseJson(request, body);

  const result = await registerAccount(input, getClientAddress);
  if (result.status === 'suppressed') return json({ ok: true });
  if (result.status === 'existing') error(409, 'An account with that email already exists');
  const created = result.user;

  const session = await createSession(created.id, getClientAddress, true);
  setSessionCookie(cookies, session.token, session.expiresAt, isSecureRequest(url));

  // Send a verification magic-link. Same handler as
  // /login's "Email me a link" — the consumer in
  // $lib/server/auth/magic-link.ts sets email_verified_at on
  // click, so this email both welcomes and verifies. Failures
  // are logged but don't block signup — clients can resend via
  // POST /api/v1/auth/verify-email/resend.
  try {
    await sendAccountLink(created, 'verification');
  } catch (err) {
    console.error('Failed to send verification email on register:', err);
  }

  const accessToken = await signAccessToken(created.id);
  const refreshToken = await createRefreshToken(created.id);

  return json({
    ok: true,
    user: publicUser(created),
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL,
  });
};
