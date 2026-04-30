/**
 * POST /api/v1/admin/phrase-proposals/promote (T-14.5a).
 *
 * Trigger the periodic promotion pass that walks the
 * `phrase_proposals` queue and turns ≥-N-chapter occurrences
 * into real `phrases` rows (`source='nlp'`). Idempotent: re-
 * running it after no new proposals have arrived is a no-op.
 *
 * Permission: admin only — promotion is a corpus-wide operation
 * that doesn't fit the language-scoped curator grant.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import { requireAdmin } from '$lib/server/dictionary/permissions.js';
import {
  PHRASE_PROMOTION_MIN_CHAPTERS,
  promotePhraseProposals,
} from '$lib/server/texts/phrase-proposals.js';
import type { RequestHandler } from './$types';

const body = z.object({
  /** Optional override for `PHRASE_PROMOTION_MIN_CHAPTERS`. The
   *  admin endpoint accepts it so a backfill against a sparse
   *  corpus can drop the floor temporarily without an env-var
   *  bounce. */
  minChapters: z.number().int().min(1).max(50).optional(),
});

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  requireAdmin(user);

  let parsed: { minChapters?: number } = {};
  // Empty body is fine — fall through to the default threshold.
  try {
    const text = await event.request.text();
    if (text.trim().length > 0) {
      const json_body = JSON.parse(text);
      const result = body.safeParse(json_body);
      if (!result.success) throw error(400, 'Invalid body');
      parsed = result.data;
    }
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e;
    throw error(400, 'Invalid JSON body');
  }

  const result = await promotePhraseProposals({
    minChapters: parsed.minChapters,
  });
  return json({
    promoted: result.promoted,
    proposalsMarked: result.proposalsMarked,
    byLanguage: result.byLanguage,
    threshold: parsed.minChapters ?? PHRASE_PROMOTION_MIN_CHAPTERS,
  });
};
