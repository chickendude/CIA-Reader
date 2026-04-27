/**
 * POST /api/v1/admin/translations/bulk-attribution (T-3.9).
 *
 * Admin-only. Rewrites `sourceAttribution` on every translation matching
 * (source, oldAttribution, language?) in one pass. Used when an upstream
 * source renames or rebrands. The query is bounded by BULK_LIMIT — if a
 * filter would touch more rows the request is rejected and the caller
 * is told to narrow.
 *
 * Response shape: { updated: number }.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import { bulkUpdateAttribution } from '$lib/server/dictionary/bulk.js';
import { CuratorValidationError } from '$lib/server/dictionary/curator.js';
import { ForbiddenError } from '$lib/server/dictionary/permissions.js';
import { MissingReasonError } from '$lib/server/dictionary/audit.js';
import type { RequestHandler } from './$types';
import { parseJson } from '../../../auth/_helpers.js';

const body = z.object({
  source: z.enum(['official_dictionary', 'curator']),
  oldAttribution: z.string().min(1).max(500),
  newAttribution: z.string().max(500).nullable(),
  language: z.enum(['hi', 'mr', 'or']).optional(),
  reason: z.string().min(3).max(500),
});

function mapErr(err: unknown): never {
  if (err instanceof CuratorValidationError) throw error(err.status, err.message);
  if (err instanceof ForbiddenError) throw error(403, err.message);
  if (err instanceof MissingReasonError) throw error(400, err.message);
  throw err;
}

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const input = await parseJson(event.request, body);
  try {
    const result = await bulkUpdateAttribution(
      user,
      {
        source: input.source,
        oldAttribution: input.oldAttribution,
        newAttribution: input.newAttribution,
        language: input.language,
      },
      input.reason,
    );
    return json(result);
  } catch (err) {
    mapErr(err);
  }
};
