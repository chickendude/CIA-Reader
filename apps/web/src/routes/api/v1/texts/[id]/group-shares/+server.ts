/**
 * GET + POST /api/v1/texts/:id/group-shares (T-7.4).
 *
 * Owner / admin only. POST { groupId } — grant a group access.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  TextShareError,
  grantTextGroupShare,
  listTextGroupShares,
} from '$lib/server/texts/sharing.js';
import { parseJson } from '../../../auth/_helpers.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const postSchema = z
  .object({ groupId: z.string().regex(UUID_RE) })
  .strict();

export const GET: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid text id');
  try {
    const shares = await listTextGroupShares(id, {
      id: user.id,
      role: user.role,
    });
    return json({ shares });
  } catch (e) {
    if (e instanceof TextShareError) throw error(e.status, e.message);
    throw e;
  }
};

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid text id');
  const body = await parseJson(event.request, postSchema);
  try {
    const share = await grantTextGroupShare({
      textId: id,
      groupId: body.groupId,
      actor: { id: user.id, role: user.role },
    });
    return json({ share }, { status: 201 });
  } catch (e) {
    if (e instanceof TextShareError) throw error(e.status, e.message);
    throw e;
  }
};
