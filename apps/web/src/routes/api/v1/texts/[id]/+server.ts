/**
 * DELETE /api/v1/texts/:id
 *
 * Owner-or-admin only. Removes the text and cascades through every
 * dependent table (chapters, tokens, NLP jobs, shares, progress,
 * collection items, audio). Non-admins who don't own the row get the
 * same 404 as if it didn't exist so we don't leak existence.
 */
import { error, json } from '@sveltejs/kit';

import { requireUser } from '$lib/server/auth/require-user.js';
import { deleteText, TextValidationError } from '$lib/server/texts/upload.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DELETE: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid text id');
  try {
    await deleteText(id, { id: user.id, role: user.role });
    return json({ ok: true });
  } catch (e) {
    if (e instanceof TextValidationError) throw error(e.status, e.message);
    throw e;
  }
};
