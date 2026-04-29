/**
 * GET + POST /api/v1/groups/:id/members (T-7.3).
 *
 * GET — list memberships. Owner / admin only.
 * POST { userId } — add a member. Owner / admin only.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  GroupError,
  addMember,
  listGroupMembers,
} from '$lib/server/groups.js';
import { parseJson } from '../../../auth/_helpers.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const postSchema = z
  .object({ userId: z.string().regex(UUID_RE) })
  .strict();

export const GET: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid group id');
  try {
    const members = await listGroupMembers({
      groupId: id,
      actor: { id: user.id, role: user.role },
    });
    return json({ members });
  } catch (e) {
    if (e instanceof GroupError) throw error(e.status, e.message);
    throw e;
  }
};

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid group id');
  const body = await parseJson(event.request, postSchema);
  try {
    const membership = await addMember({
      groupId: id,
      userId: body.userId,
      actor: { id: user.id, role: user.role },
    });
    return json({ membership }, { status: 201 });
  } catch (e) {
    if (e instanceof GroupError) throw error(e.status, e.message);
    throw e;
  }
};
