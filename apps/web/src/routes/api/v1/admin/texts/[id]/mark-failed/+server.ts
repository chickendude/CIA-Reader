/**
 * POST /api/v1/admin/texts/:id/mark-failed (T-4.4).
 *
 * Admin-only callback for the NLP worker's failure path. Body:
 * `{ error: string }` — the worker's truncated traceback. Empty body
 * defaults to a generic message.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import { isAdmin } from '$lib/server/dictionary/permissions.js';
import { markTextFailed } from '$lib/server/texts/jobs.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const body = z.object({
  error: z.string().min(1).max(2000),
});

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  if (!isAdmin({ role: user.role })) {
    throw error(403, 'Admin role required');
  }
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid text id');
  let parsed: { error: string };
  try {
    const json_body = await event.request.json();
    const result = body.safeParse(json_body);
    if (!result.success) throw error(400, 'Invalid body');
    parsed = result.data;
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e;
    throw error(400, 'Invalid JSON body');
  }
  await markTextFailed(id, parsed.error);
  return json({ ok: true });
};
