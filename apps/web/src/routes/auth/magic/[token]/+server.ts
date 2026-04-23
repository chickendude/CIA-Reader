import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consumeMagicLink } from '$lib/server/auth/magic-link.js';
import { createSession, setSessionCookie } from '$lib/server/auth/sessions.js';
import { isSecureRequest } from '../../../api/v1/auth/_helpers.js';

/**
 * Landing page for the magic-link URL emailed to the user. Consumes the token,
 * establishes a web session, and redirects to the home page.
 *
 * API/mobile clients should POST to `/api/v1/auth/magic-link/consume` instead
 * so they receive bearer tokens in the response body.
 */
export const GET: RequestHandler = async ({ params, cookies, url }) => {
  const user = await consumeMagicLink(params.token);
  if (!user) {
    throw redirect(303, '/?auth_error=invalid_magic_link');
  }
  const session = await createSession(user.id);
  setSessionCookie(cookies, session.token, session.expiresAt, isSecureRequest(url));
  throw redirect(303, '/');
};
