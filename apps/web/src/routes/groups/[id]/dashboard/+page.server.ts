/**
 * Classroom / group dashboard (T-7.8).
 *
 * Owner-or-admin only. Aggregates per-member reading progress on
 * the texts shared with the group.
 */
import { error, redirect } from '@sveltejs/kit';

import { GroupError } from '$lib/server/groups.js';
import { loadGroupDashboard } from '$lib/server/group-stats.js';
import type { PageServerLoad } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const load: PageServerLoad = async ({ params, locals, url }) => {
  if (!locals.user) {
    throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
  }
  const id = params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid group id');
  try {
    const dashboard = await loadGroupDashboard(id, {
      id: locals.user.id,
      role: locals.user.role,
    });
    return { dashboard };
  } catch (e) {
    if (e instanceof GroupError) throw error(e.status, e.message);
    throw e;
  }
};
