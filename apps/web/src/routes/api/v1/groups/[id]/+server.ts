/**
 * DELETE /api/v1/groups/:id (T-7.3). Owner-or-admin only.
 */
import { error, json } from '@sveltejs/kit';

import { requireUser } from '$lib/server/auth/require-user.js';
import { GroupError, deleteGroup } from '$lib/server/groups.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DELETE: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid group id');
  try {
    await deleteGroup({
      groupId: id,
      actor: { id: user.id, role: user.role },
    });
    return json({ ok: true });
  } catch (e) {
    if (e instanceof GroupError) throw error(e.status, e.message);
    throw e;
  }
};
