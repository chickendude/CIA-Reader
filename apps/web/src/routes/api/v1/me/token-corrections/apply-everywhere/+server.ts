/**
 * POST /api/v1/me/token-corrections/apply-everywhere (T-6.2b).
 *
 * Replicates the acting user's correction on `sourceTokenId`
 * across every matching token (same surface, optionally same
 * primary lemma). Backs the "Apply everywhere" buttons in the
 * post-correction toast.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  CorrectionValidationError,
  applyCorrectionEverywhere,
} from '$lib/server/corrections.js';
import { parseJson } from '../../../auth/_helpers.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z
  .object({
    sourceTokenId: z.string().regex(UUID_RE),
    scope: z.enum(['same-context', 'all-contexts']),
  })
  .strict();

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const body = await parseJson(event.request, bodySchema);
  try {
    const result = await applyCorrectionEverywhere({
      userId: user.id,
      sourceTokenId: body.sourceTokenId,
      scope: body.scope,
    });
    return json(result);
  } catch (e) {
    if (e instanceof CorrectionValidationError) {
      throw error(e.status, e.message);
    }
    throw e;
  }
};
