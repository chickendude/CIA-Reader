/**
 * POST /api/v1/admin/translations/bulk-promote (T-3.9).
 *
 * Admin-only. Re-tags a set of community (`source='user'`) translations
 * as curator translations in one pass. Officials are explicitly skipped
 * (same one-way guard as `updateTranslation`).
 *
 * Response shape:
 *   { promoted: number, skipped: Array<{ id: string, reason: string }> }
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  bulkPromoteTranslations,
  BULK_LIMIT,
} from '$lib/server/dictionary/bulk.js';
import { CuratorValidationError } from '$lib/server/dictionary/curator.js';
import { ForbiddenError } from '$lib/server/dictionary/permissions.js';
import { MissingReasonError } from '$lib/server/dictionary/audit.js';
import type { RequestHandler } from './$types';
import { parseJson } from '../../../auth/_helpers.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const body = z.object({
  translationIds: z
    .array(z.string().regex(UUID_RE, 'must be a UUID'))
    .min(1)
    .max(BULK_LIMIT),
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
    const result = await bulkPromoteTranslations(
      user,
      input.translationIds,
      input.reason,
    );
    return json(result);
  } catch (err) {
    mapErr(err);
  }
};
