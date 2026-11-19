import { json } from '@sveltejs/kit';

import { requireUser } from '$lib/server/auth/require-user.js';
import { listGroupsForUser } from '$lib/server/groups.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const groups = await listGroupsForUser(user.id);
  return json({ groups });
};
