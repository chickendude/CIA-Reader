/**
 * POST /api/v1/collections/:id/items { textId, position? } (T-8.1).
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  CollectionError,
  addCollectionItem,
} from '$lib/server/collections.js';
import { parseJson } from '../../../auth/_helpers.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const postSchema = z
  .object({
    textId: z.string().regex(UUID_RE),
    position: z.number().int().min(0).optional(),
  })
  .strict();

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid collection id');
  const body = await parseJson(event.request, postSchema);
  try {
    const item = await addCollectionItem({
      collectionId: id,
      textId: body.textId,
      position: body.position,
      actor: { id: user.id, role: user.role },
    });
    return json({ item }, { status: 201 });
  } catch (e) {
    if (e instanceof CollectionError) throw error(e.status, e.message);
    throw e;
  }
};
