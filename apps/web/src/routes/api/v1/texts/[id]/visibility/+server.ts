/**
 * PATCH /api/v1/texts/:id/visibility (T-7.1).
 *
 * Updates a text's visibility. Owner-only for private↔shared;
 * admin-only for promoting to / demoting from 'official'.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  TextVisibilityError,
  setTextVisibility,
} from '$lib/server/texts/visibility.js';
import { parseJson } from '../../../auth/_helpers.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z
  .object({
    visibility: z.enum(['private', 'shared', 'official']),
  })
  .strict();

export const PATCH: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid text id');
  const body = await parseJson(event.request, bodySchema);
  try {
    const text = await setTextVisibility({
      textId: id,
      actor: { id: user.id, role: user.role },
      next: body.visibility,
    });
    return json({ text });
  } catch (e) {
    if (e instanceof TextVisibilityError) throw error(e.status, e.message);
    throw e;
  }
};
