/**
 * POST /api/v1/admin/texts/:id/mark-ready (T-4.4).
 *
 * Admin-only callback the NLP worker invokes when tokenization
 * succeeds. Also handy for dev/testing — without it, exercising the
 * polling UI requires standing up the full arq worker. The worker's
 * public contract (services/nlp/app/worker/store.py) maps directly
 * onto this endpoint + its `mark-failed` sibling.
 */
import { error, json } from '@sveltejs/kit';

import { requireUser } from '$lib/server/auth/require-user.js';
import { isAdmin } from '$lib/server/dictionary/permissions.js';
import { markTextReady } from '$lib/server/texts/jobs.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  if (!isAdmin({ role: user.role })) {
    throw error(403, 'Admin role required');
  }
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid text id');
  await markTextReady(id);
  return json({ ok: true });
};
