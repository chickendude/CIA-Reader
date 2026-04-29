/**
 * GET + POST /api/v1/collections/:id/shares (T-8.4).
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  CollectionError,
  grantCollectionShare,
  listCollectionShares,
} from '$lib/server/collections.js';
import { parseJson } from '../../../auth/_helpers.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const postSchema = z
  .object({ recipientUserId: z.string().regex(UUID_RE) })
  .strict();

export const GET: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid collection id');
  try {
    const shares = await listCollectionShares(id, {
      id: user.id,
      role: user.role,
    });
    return json({ shares });
  } catch (e) {
    if (e instanceof CollectionError) throw error(e.status, e.message);
    throw e;
  }
};

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid collection id');
  const body = await parseJson(event.request, postSchema);
  try {
    const share = await grantCollectionShare({
      collectionId: id,
      recipientUserId: body.recipientUserId,
      actor: { id: user.id, role: user.role },
    });
    return json({ share }, { status: 201 });
  } catch (e) {
    if (e instanceof CollectionError) throw error(e.status, e.message);
    throw e;
  }
};
