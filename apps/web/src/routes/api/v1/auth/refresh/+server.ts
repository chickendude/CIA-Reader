import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { rotateRefreshToken } from '$lib/server/auth/refresh.js';
import { signAccessToken, ACCESS_TOKEN_TTL } from '$lib/server/auth/access-token.js';
import { parseJson, publicUser } from '../_helpers.js';

const body = z.object({ refreshToken: z.string().min(1) });

export const POST: RequestHandler = async ({ request }) => {
  const input = await parseJson(request, body);
  const rotated = await rotateRefreshToken(input.refreshToken);
  if (!rotated) throw error(401, 'Invalid or expired refresh token');

  const accessToken = await signAccessToken(rotated.user.id);
  return json({
    user: publicUser(rotated.user),
    accessToken,
    refreshToken: rotated.newToken,
    expiresIn: ACCESS_TOKEN_TTL,
  });
};
