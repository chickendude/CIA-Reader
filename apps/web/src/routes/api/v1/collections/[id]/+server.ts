/**
 * PATCH + DELETE /api/v1/collections/:id (T-8.1).
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  CollectionError,
  deleteCollection,
  updateCollection,
} from '$lib/server/collections.js';
import { parseJson } from '../../auth/_helpers.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).nullable(),
    coverUrl: z.string().url().max(500).nullable(),
    kind: z.enum(['chapter_book', 'course', 'anthology']),
    visibility: z.enum(['private', 'shared', 'official']),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field required',
  });

export const PATCH: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid collection id');
  const body = await parseJson(event.request, patchSchema);
  try {
    const collection = await updateCollection({
      collectionId: id,
      actor: { id: user.id, role: user.role },
      patch: body,
    });
    return json({ collection });
  } catch (e) {
    if (e instanceof CollectionError) throw error(e.status, e.message);
    throw e;
  }
};

export const DELETE: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid collection id');
  try {
    await deleteCollection({
      collectionId: id,
      actor: { id: user.id, role: user.role },
    });
    return json({ ok: true });
  } catch (e) {
    if (e instanceof CollectionError) throw error(e.status, e.message);
    throw e;
  }
};
