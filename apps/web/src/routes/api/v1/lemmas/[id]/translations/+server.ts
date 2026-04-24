/**
 * GET /api/v1/lemmas/:id/translations (T-3.3).
 *
 * Public read — no auth required (dictionary browse is public, and the
 * reader pop-up loads this shape on every tap). When the caller IS
 * authenticated, their own submissions are pulled into the `personal`
 * bucket so the UI can render them at the top of the pop-up per T-3.8.
 *
 * Hidden community rows are suppressed for anonymous + non-curator
 * viewers; curators and admins see everything.
 */
import { error, json } from '@sveltejs/kit';

import { resolveUser } from '$lib/server/auth/require-user.js';
import {
  getLemmaTranslations,
  LemmaNotFoundError,
} from '$lib/server/dictionary/lookups.js';
import type { RequestHandler } from './$types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET: RequestHandler = async (event) => {
  const { id } = event.params;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid lemma id');

  const user = await resolveUser(event);
  const viewer = user ? { id: user.id, role: user.role } : null;

  try {
    const result = await getLemmaTranslations(id, viewer);
    return json(result);
  } catch (err) {
    if (err instanceof LemmaNotFoundError) throw error(404, 'Lemma not found');
    throw err;
  }
};
