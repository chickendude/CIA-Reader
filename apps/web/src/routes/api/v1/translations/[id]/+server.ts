/**
 * PATCH + DELETE /api/v1/translations/:id (T-3.5).
 *
 * The author of a user-submitted translation can edit or delete it
 * here. Officials are untouchable via this route — those go through
 * the curator dictionary editor (T-3.7). Hiding a community translation
 * is a moderator action and lives separately.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireVerifiedUser } from '$lib/server/auth/require-user.js';
import {
  deleteUserTranslation,
  publicTranslation,
  TranslationValidationError,
  updateUserTranslation,
} from '$lib/server/dictionary/translations.js';
import type { RequestHandler } from './$types';
import { parseJson } from '../../auth/_helpers.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchBody = z
  .object({
    body: z.string().optional(),
    // Toggle a note between community-visible and author-only.
    isPrivate: z.boolean().optional(),
  })
  .refine((v) => v.body !== undefined || v.isPrivate !== undefined, {
    message: 'Provide body or isPrivate to update',
  });

function mapTranslationError(err: unknown): never {
  if (err instanceof TranslationValidationError) {
    throw error(err.status, err.message);
  }
  throw err;
}

export const PATCH: RequestHandler = async (event) => {
  const user = await requireVerifiedUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid translation id');
  const input = await parseJson(event.request, patchBody);
  try {
    const updated = await updateUserTranslation(user.id, id, input);
    return json({ translation: publicTranslation(updated) });
  } catch (err) {
    mapTranslationError(err);
  }
};

export const DELETE: RequestHandler = async (event) => {
  const user = await requireVerifiedUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid translation id');
  try {
    await deleteUserTranslation(user.id, id);
    return new Response(null, { status: 204 });
  } catch (err) {
    mapTranslationError(err);
  }
};
