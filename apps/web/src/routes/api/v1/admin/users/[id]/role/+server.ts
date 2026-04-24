/**
 * POST /api/v1/admin/users/:id/role (T-3.4).
 *
 * Admin-only. Changes a user's role. Refuses to demote the last admin
 * so the system can't accidentally be orphaned.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  LastAdminError,
  setUserRole,
  UserNotFoundError,
} from '$lib/server/dictionary/admin.js';
import { isAdmin } from '$lib/server/dictionary/permissions.js';
import type { RequestHandler } from './$types';
import { parseJson } from '../../../../auth/_helpers.js';

const body = z.object({
  role: z.enum(['user', 'curator', 'admin']),
});

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  if (!isAdmin(user)) throw error(403, 'Admin role required');
  if (!event.params.id) throw error(400, 'Missing user id');

  const input = await parseJson(event.request, body);
  try {
    const updated = await setUserRole(event.params.id, input.role);
    return json({ user: { id: updated.id, email: updated.email, role: updated.role } });
  } catch (err) {
    if (err instanceof UserNotFoundError) throw error(404, 'User not found');
    if (err instanceof LastAdminError) throw error(409, err.message);
    throw err;
  }
};
