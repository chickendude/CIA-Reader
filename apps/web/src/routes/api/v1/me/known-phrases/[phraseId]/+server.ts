/**
 * PATCH /api/v1/me/known-phrases/:phraseId (T-14.1).
 *
 * Direct parallel to PATCH /api/v1/me/known-lemmas/:lemmaId (T-5.5)
 * but for phrase-level status. Reader pop-up phrase mode (T-14.3)
 * wires its Learning / Known / Ignored buttons through this. Body:
 * `{ status: 'unknown' | 'learning' | 'known' | 'ignored' }`.
 * Response: 200 with the updated row; the per-language phrases
 * counter cache is recomputed in the same transaction so the
 * stats card on the profile page (T-14.6) stays current without
 * a separate fetch.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  setKnownPhraseStatus,
  PhraseValidationError,
} from '$lib/server/phrases.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const body = z.object({
  status: z.enum(['unknown', 'learning', 'known', 'ignored']),
});

export const PATCH: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const phraseId = event.params.phraseId;
  if (!phraseId || !UUID_RE.test(phraseId)) {
    throw error(400, 'Invalid phrase id');
  }

  let parsed: { status: 'unknown' | 'learning' | 'known' | 'ignored' };
  try {
    const json_body = await event.request.json();
    const result = body.safeParse(json_body);
    if (!result.success) throw error(400, 'Invalid body');
    parsed = result.data;
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e;
    throw error(400, 'Invalid JSON body');
  }

  try {
    const row = await setKnownPhraseStatus({
      userId: user.id,
      phraseId,
      status: parsed.status,
    });
    return json({
      knownPhrase: {
        userId: row.userId,
        phraseId: row.phraseId,
        status: row.status,
        updatedAt: row.updatedAt,
      },
    });
  } catch (err) {
    if (err instanceof PhraseValidationError) {
      throw error(err.status, err.message);
    }
    throw err;
  }
};
