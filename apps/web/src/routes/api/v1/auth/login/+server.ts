import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { checkPasswordLogin, passwordWaitMessage } from '$lib/server/auth/password-access.js';
import { createSession, setSessionCookie } from '$lib/server/auth/sessions.js';
import { signAccessToken, ACCESS_TOKEN_TTL } from '$lib/server/auth/access-token.js';
import { createRefreshToken } from '$lib/server/auth/refresh.js';
import { emailSchema, isSecureRequest, parseJson, publicUser } from '../_helpers.js';

const body = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
});

export const POST: RequestHandler = async ({ request, cookies, url, getClientAddress }) => {
  const input = await parseJson(request, body);

  const result = await checkPasswordLogin(input.email, input.password, getClientAddress);
  if (result.status === 'limited') {
    return json({ message: passwordWaitMessage(result.retryAfter) }, {
      status: 429, headers: { 'Retry-After': String(result.retryAfter) },
    });
  }
  if (result.status === 'invalid') error(401, 'Invalid email or password');
  const user = result.user;

  const session = await createSession(user.id, getClientAddress);
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
