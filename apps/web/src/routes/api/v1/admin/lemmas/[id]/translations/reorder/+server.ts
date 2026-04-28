/**
 * PATCH /api/v1/admin/lemmas/:id/translations/reorder (T-3.13).
 *
 * Caller passes the canonical ordered list of translation ids for the
 * lemma. The service writes `display_rank` by index and audits a single
 * `translation_reorder` row with before/after snapshots.
 *
 * Partial reorders are not supported — if the caller doesn't include
 * every translation currently on the lemma, the service rejects with
 * 409 so the UI re-fetches and tries again. This pattern keeps the
 * reorder endpoint trivially idempotent under retry.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  CuratorValidationError,
  reorderTranslations,
} from '$lib/server/dictionary/curator.js';
import { ForbiddenError } from '$lib/server/dictionary/permissions.js';
import { MissingReasonError } from '$lib/server/dictionary/audit.js';
import type { RequestHandler } from './$types';
import { parseJson } from '../../../../../auth/_helpers.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const body = z.object({
  orderedTranslationIds: z
    .array(z.string().regex(UUID_RE, 'must be a UUID'))
    .min(1),
  reason: z.string().min(3).max(500),
});

function mapCuratorError(err: unknown): never {
  if (err instanceof CuratorValidationError) throw error(err.status, err.message);
  if (err instanceof ForbiddenError) throw error(403, err.message);
  if (err instanceof MissingReasonError) throw error(400, err.message);
  throw err;
}

export const PATCH: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const lemmaId = event.params.id;
  if (!lemmaId || !UUID_RE.test(lemmaId)) throw error(400, 'Invalid lemma id');
  const input = await parseJson(event.request, body);
  try {
    const translations = await reorderTranslations(
      user,
      lemmaId,
      input.orderedTranslationIds,
      input.reason,
    );
    return json({ translations });
  } catch (err) {
    mapCuratorError(err);
  }
};
