import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { consumeMagicLink } from '$lib/server/auth/magic-link.js';
import { createSession, setSessionCookie } from '$lib/server/auth/sessions.js';
import { signAccessToken, ACCESS_TOKEN_TTL } from '$lib/server/auth/access-token.js';
import { createRefreshToken } from '$lib/server/auth/refresh.js';
import { isSecureRequest, parseJson, publicUser } from '../../_helpers.js';

const body = z.object({ token: z.string().min(1) });

export const POST: RequestHandler = async ({ request, cookies, url }) => {
  const input = await parseJson(request, body);
  const user = await consumeMagicLink(input.token);
  if (!user) throw error(401, 'Invalid or expired magic link');

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
