import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth/require-user.js';
import { publicUser } from '../_helpers.js';

export const GET: RequestHandler = async (event) => {
  const user = await requireUser(event);
  return json({ user: publicUser(user) });
};
