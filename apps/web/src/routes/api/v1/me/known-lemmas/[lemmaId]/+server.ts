/**
 * PATCH /api/v1/me/known-lemmas/:lemmaId (T-5.5).
 *
 * Upsert the caller's known-status for a lemma. The reader pop-up's
 * Learning / Known / Ignored buttons (T-5.4) call this with the
 * status value the user picked.
 *
 * Body: `{ status: 'unknown' | 'learning' | 'known' | 'ignored' }`.
 * Response: 200 with the updated row + the user's new known-words
 * count for the affected language so the stats card can update
 * without a separate fetch.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import { setKnownLemmaStatus } from '$lib/server/texts/tokens.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const body = z.object({
  status: z.enum(['unknown', 'learning', 'known', 'ignored']),
});

export const PATCH: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const lemmaId = event.params.lemmaId;
  if (!lemmaId || !UUID_RE.test(lemmaId)) throw error(400, 'Invalid lemma id');

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
    const row = await setKnownLemmaStatus({
      userId: user.id,
      lemmaId,
      status: parsed.status,
    });
    return json({
      knownLemma: {
        userId: row.userId,
        lemmaId: row.lemmaId,
        status: row.status,
        updatedAt: row.updatedAt,
      },
    });
  } catch (err) {
    if ((err as Error).message?.includes('not found')) {
      throw error(404, (err as Error).message);
    }
    throw err;
  }
};
