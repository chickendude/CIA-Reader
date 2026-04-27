/**
 * GET /api/v1/texts/:id/status (T-4.4).
 *
 * Lightweight polling endpoint the reader page hits while a text is
 * still being processed by the NLP worker. Returns the current
 * `status` enum value + any `statusError` and the most recent
 * `nlp_jobs` row's progress fields.
 *
 * Owner-scoped — non-owners get a flat 404 to avoid leaking text
 * existence. Sharing visibility lands in T-4.6 with the central
 * `assertCanRead` helper.
 */
import { error, json } from '@sveltejs/kit';

import { requireUser } from '$lib/server/auth/require-user.js';
import { getTextStatus } from '$lib/server/texts/jobs.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid text id');
  const view = await getTextStatus({ id: user.id }, id);
  if (!view) throw error(404, 'Text not found');
  return json({
    status: view.status,
    statusError: view.statusError,
    job: view.job
      ? {
          id: view.job.id,
          status: view.job.status,
          error: view.job.error,
          startedAt: view.job.startedAt,
          finishedAt: view.job.finishedAt,
          createdAt: view.job.createdAt,
        }
      : null,
  });
};
