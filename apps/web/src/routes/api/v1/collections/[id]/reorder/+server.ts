/**
 * POST /api/v1/collections/:id/reorder { textIds: string[] } (T-8.1).
 *
 * Rewrites every member's position in one transaction. Submitted
 * id list must match the existing membership exactly.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  CollectionError,
  reorderCollection,
} from '$lib/server/collections.js';
import { parseJson } from '../../../auth/_helpers.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z
  .object({
    textIds: z.array(z.string().regex(UUID_RE)).min(1).max(500),
  })
  .strict();

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid collection id');
  const body = await parseJson(event.request, bodySchema);
  try {
    const items = await reorderCollection({
      collectionId: id,
      textIds: body.textIds,
      actor: { id: user.id, role: user.role },
    });
    return json({ items });
  } catch (e) {
    if (e instanceof CollectionError) throw error(e.status, e.message);
    throw e;
  }
};
