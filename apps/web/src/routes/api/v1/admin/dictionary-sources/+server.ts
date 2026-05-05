/**
 * Polling endpoint for the admin dictionary-sources page (T-3.14).
 *
 * Returns the same row shape the page loader produces. The Svelte
 * page polls this every 2 s while any row has an in-flight job so
 * the "Re-fetch" / "Re-import" buttons can flip back to idle without
 * a full server-rendered reload. Admin-only (the page itself is too,
 * but the API has its own gate so a curl with stale auth doesn't get
 * a list of source slugs + last-import errors).
 */
import { error, json } from '@sveltejs/kit';

import { listSourceStatuses } from '$lib/server/dictionary/admin-imports.js';
import { isAdmin } from '$lib/server/dictionary/permissions.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) throw error(401, 'Unauthorized');
  if (!isAdmin({ role: locals.user.role })) throw error(403, 'Admin role required');
  const sources = await listSourceStatuses();
  return json({ sources });
};
