/**
 * POST /api/v1/me/token-corrections (T-6.1).
 *
 * The reader's WordPopup posts here when the user picks an
 * alternate lemma, marks the token as a proper noun, or otherwise
 * overrides the worker's parse. The body is a single correction;
 * upserts on (user, token).
 *
 * The endpoint is intentionally per-token. T-6.2b's "apply
 * everywhere" follow-up writes a separate batch surface.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  CorrectionValidationError,
  writeTokenCorrection,
} from '$lib/server/corrections.js';
import { parseJson } from '../../auth/_helpers.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z
  .object({
    tokenId: z.string().regex(UUID_RE, 'tokenId must be a uuid'),
    type: z.enum([
      'pick_candidate',
      'manual_lemma',
      'new_lemma',
      'mark_proper_noun',
      'mark_foreign',
      'mark_not_a_word',
    ]),
    chosenLemmaId: z
      .string()
      .regex(UUID_RE, 'chosenLemmaId must be a uuid')
      .nullable()
      .optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const body = await parseJson(event.request, bodySchema);

  try {
    const row = await writeTokenCorrection({
      userId: user.id,
      tokenId: body.tokenId,
      type: body.type,
      chosenLemmaId: body.chosenLemmaId ?? null,
      note: body.note ?? null,
    });
    return json({ correction: row }, { status: 201 });
  } catch (err) {
    if (err instanceof CorrectionValidationError) {
      throw error(err.status, err.message);
    }
    throw err;
  }
};
