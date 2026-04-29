/**
 * DELETE /api/v1/collections/:id/shares/:userId (T-8.4).
 */
import { error, json } from '@sveltejs/kit';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  CollectionError,
  revokeCollectionShare,
} from '$lib/server/collections.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DELETE: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  const userId = event.params.userId;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid collection id');
  if (!userId || !UUID_RE.test(userId)) throw error(400, 'Invalid user id');
  try {
    await revokeCollectionShare({
      collectionId: id,
      recipientUserId: userId,
      actor: { id: user.id, role: user.role },
    });
    return json({ ok: true });
  } catch (e) {
    if (e instanceof CollectionError) throw error(e.status, e.message);
    throw e;
  }
};
