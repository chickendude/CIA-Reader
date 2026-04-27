/**
 * POST /api/v1/admin/texts/:id/reprocess (T-4.4 dev affordance,
 * future T-6.8 home).
 *
 * Re-run the NLP pipeline on an existing text — used to recover
 * stuck `pending` texts (e.g. when the dispatcher wasn't registered
 * at upload time) and as the entry point for T-6.8's bulk
 * re-processing after dictionary / override updates.
 *
 * Synchronous (awaits the full process), so the caller can tell
 * whether the run succeeded. Admin-only.
 */
import { error, json } from '@sveltejs/kit';

import { requireUser } from '$lib/server/auth/require-user.js';
import { isAdmin } from '$lib/server/dictionary/permissions.js';
import { processTextNow } from '$lib/server/texts/in-process-dispatcher.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  if (!isAdmin({ role: user.role })) throw error(403, 'Admin role required');
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid text id');
  const total = await processTextNow(id);
  return json({ ok: true, tokensWritten: total });
};
