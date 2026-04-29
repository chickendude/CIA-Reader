/**
 * DELETE /api/v1/texts/:id/shares/:userId (T-7.2).
 *
 * Revokes a recipient's read access. Owner / admin only.
 */
import { error, json } from '@sveltejs/kit';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  TextShareError,
  revokeTextShare,
} from '$lib/server/texts/sharing.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DELETE: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  const recipientId = event.params.userId;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid text id');
  if (!recipientId || !UUID_RE.test(recipientId)) {
    throw error(400, 'Invalid user id');
  }
  try {
    await revokeTextShare({
      textId: id,
      recipientUserId: recipientId,
      actor: { id: user.id, role: user.role },
    });
    return json({ ok: true });
  } catch (e) {
    if (e instanceof TextShareError) throw error(e.status, e.message);
    throw e;
  }
};
