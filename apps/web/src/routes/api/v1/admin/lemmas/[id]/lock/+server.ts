/**
 * PATCH /api/v1/admin/lemmas/:id/lock (T-3.7).
 *
 * Flip `curatorLocked`. Unlocking explicitly opts the row back in for
 * fresh upstream imports to overwrite; locking is the default any time
 * a curator touches a row via updateLemma.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  CuratorValidationError,
  setLemmaLock,
} from '$lib/server/dictionary/curator.js';
import { ForbiddenError } from '$lib/server/dictionary/permissions.js';
import { MissingReasonError } from '$lib/server/dictionary/audit.js';
import type { RequestHandler } from './$types';
import { parseJson } from '../../../../auth/_helpers.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const body = z.object({
  locked: z.boolean(),
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
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid lemma id');
  const input = await parseJson(event.request, body);
  try {
    const lemma = await setLemmaLock(user, id, input.locked, input.reason);
    return json({ lemma });
  } catch (err) {
    mapCuratorError(err);
  }
};
