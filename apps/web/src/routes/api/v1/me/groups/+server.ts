/**
 * GET /api/v1/me/groups (T-7.3).
 *
 * Lists groups the acting user belongs to (owner OR member). Used
 * by T-7.4's share-with-group dropdown.
 */
import { json } from '@sveltejs/kit';

import { requireUser } from '$lib/server/auth/require-user.js';
import { listGroupsForUser } from '$lib/server/groups.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const groups = await listGroupsForUser(user.id);
  return json({ groups });
};
