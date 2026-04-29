/**
 * GET /api/v1/me/collections (T-8.1).
 */
import { json } from '@sveltejs/kit';

import { requireUser } from '$lib/server/auth/require-user.js';
import { listCollectionsForUser } from '$lib/server/collections.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const items = await listCollectionsForUser(user.id);
  return json({ collections: items });
};
