/**
 * POST /api/v1/admin/lemmas/:id/merge (T-3.7).
 *
 * `:id` is the **winner** — the lemma that will remain after the merge.
 * Body carries the loser id and a human reason. Rewires translations +
 * lemma_forms, deletes the loser, and audits both sides.
 *
 * Out of scope at M3: rewiring `text_tokens`, `user_known_lemmas`, and
 * `form_lemma_overrides`. Those tables land in M5/M6 and the merge
 * function will extend then.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  CuratorValidationError,
  mergeLemmas,
} from '$lib/server/dictionary/curator.js';
import { ForbiddenError } from '$lib/server/dictionary/permissions.js';
import { MissingReasonError } from '$lib/server/dictionary/audit.js';
import type { RequestHandler } from './$types';
import { parseJson } from '../../../../auth/_helpers.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const body = z.object({
  loserId: z.string(),
  reason: z.string(),
});

function mapCuratorError(err: unknown): never {
  if (err instanceof CuratorValidationError) throw error(err.status, err.message);
  if (err instanceof ForbiddenError) throw error(403, err.message);
  if (err instanceof MissingReasonError) throw error(400, err.message);
  throw err;
}

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const winnerId = event.params.id;
  if (!winnerId || !UUID_RE.test(winnerId)) throw error(400, 'Invalid lemma id');
  const input = await parseJson(event.request, body);
  if (!UUID_RE.test(input.loserId)) throw error(400, 'Invalid loserId');
  try {
    const result = await mergeLemmas(
      user,
      { winnerId, loserId: input.loserId },
      input.reason,
    );
    return json({
      winner: result.winner,
      translationsMoved: result.translationsMoved,
      formsMoved: result.formsMoved,
    });
  } catch (err) {
    mapCuratorError(err);
  }
};
