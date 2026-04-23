import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import {
  clearSessionCookie,
  invalidateSession,
  readSessionCookie,
} from '$lib/server/auth/sessions.js';
import { revokeRefreshToken } from '$lib/server/auth/refresh.js';
import { isSecureRequest } from '../_helpers.js';

const body = z
  .object({ refreshToken: z.string().min(1).optional() })
  .optional();

export const POST: RequestHandler = async ({ request, cookies, url }) => {
  // Body is optional for web clients, which only need cookie invalidation.
  let input: { refreshToken?: string } | undefined;
  if (request.headers.get('content-length')) {
    try {
      const parsed = body.safeParse(await request.json());
      if (parsed.success) input = parsed.data ?? undefined;
    } catch {
      // ignore malformed body — logout should always succeed
    }
  }

  const cookieToken = readSessionCookie(cookies);
  if (cookieToken) await invalidateSession(cookieToken);
  clearSessionCookie(cookies, isSecureRequest(url));

  if (input?.refreshToken) {
    await revokeRefreshToken(input.refreshToken);
  }

  return json({ ok: true });
};
