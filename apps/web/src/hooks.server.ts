import type { Handle } from '@sveltejs/kit';
import { resolveUser } from '$lib/server/auth/require-user.js';

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.user = await resolveUser(event);
  return resolve(event);
};
