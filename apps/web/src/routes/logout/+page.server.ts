/**
 * Logout — a POST action that clears the session cookie + invalidates
 * the underlying session row. There's no UI for this page; the user
 * lands here only via a form POST from the shell. A GET redirects
 * home so a stale link can't show "you're logged out" without
 * actually doing anything.
 */
import { redirect } from '@sveltejs/kit';

import {
  clearSessionCookie,
  invalidateSession,
  readSessionCookie,
} from '$lib/server/auth/sessions.js';
import { isSecureRequest } from '../api/v1/auth/_helpers.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
  // Hitting /logout via GET shouldn't do anything destructive (POST
  // is the right verb for state-changing actions). Send the user
  // home so they can use the actual sign-out button in the shell.
  throw redirect(303, '/');
};

export const actions: Actions = {
  default: async ({ cookies, url }) => {
    const token = readSessionCookie(cookies);
    if (token) await invalidateSession(token);
    clearSessionCookie(cookies, isSecureRequest(url));
    throw redirect(303, '/');
  },
};
