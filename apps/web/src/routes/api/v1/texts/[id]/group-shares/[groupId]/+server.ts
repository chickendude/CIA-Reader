/**
 * DELETE /api/v1/texts/:id/group-shares/:groupId (T-7.4).
 */
import { error, json } from '@sveltejs/kit';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  TextShareError,
  revokeTextGroupShare,
} from '$lib/server/texts/sharing.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DELETE: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  const groupId = event.params.groupId;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid text id');
  if (!groupId || !UUID_RE.test(groupId)) throw error(400, 'Invalid group id');
  try {
    await revokeTextGroupShare({
      textId: id,
      groupId,
      actor: { id: user.id, role: user.role },
    });
    return json({ ok: true });
  } catch (e) {
    if (e instanceof TextShareError) throw error(e.status, e.message);
    throw e;
  }
};
