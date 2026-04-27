/**
 * PATCH /api/v1/admin/translations/:id/hidden (T-3.7).
 *
 * Hide or unhide a community (source=user) translation. Officials are
 * not hidden — they're edited in place through the main translation
 * PATCH and audited via `lemma_edit_history`.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  CuratorValidationError,
  setTranslationHidden,
} from '$lib/server/dictionary/curator.js';
import { ForbiddenError } from '$lib/server/dictionary/permissions.js';
import { MissingReasonError } from '$lib/server/dictionary/audit.js';
import type { RequestHandler } from './$types';
import { parseJson } from '../../../../auth/_helpers.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const body = z.object({
  hidden: z.boolean(),
  reason: z.string(),
});

function mapCuratorError(err: unknown): never {
  if (err instanceof CuratorValidationError) throw error(err.status, err.message);
  if (err instanceof ForbiddenError) throw error(403, err.message);
  if (err instanceof MissingReasonError) throw error(400, err.message);
  throw err;
}

export const PATCH: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid translation id');
  const input = await parseJson(event.request, body);
  try {
    const translation = await setTranslationHidden(
      user,
      id,
      input.hidden,
      input.reason,
    );
    return json({ translation });
  } catch (err) {
    mapCuratorError(err);
  }
};
