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
import { sentenceAround } from '$lib/server/texts/sentences.js';
import { setKnownLemmaStatus } from '$lib/server/texts/tokens.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const body = z.object({
  status: z.enum(['unknown', 'learning', 'known', 'ignored']),
  // Optional reading context — when present we capture the sentence the word
  // was mined from for the Anki export.
  chapterId: z.string().uuid().optional(),
  tokenIdx: z.number().int().nonnegative().optional(),
});

export const PATCH: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const lemmaId = event.params.lemmaId;
  if (!lemmaId || !UUID_RE.test(lemmaId)) throw error(400, 'Invalid lemma id');

  let parsed: z.infer<typeof body>;
  try {
    const json_body = await event.request.json();
    const result = body.safeParse(json_body);
    if (!result.success) throw error(400, 'Invalid body');
    parsed = result.data;
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e;
    throw error(400, 'Invalid JSON body');
  }

  // Reconstruct the mined sentence when the reader supplied context.
  let mined: { minedSentence: string; minedChapterId: string; minedTokenIdx: number } | undefined;
  if (parsed.chapterId !== undefined && parsed.tokenIdx !== undefined) {
    try {
      const sentence = await sentenceAround(parsed.chapterId, parsed.tokenIdx);
      if (sentence) {
        mined = {
          minedSentence: sentence,
          minedChapterId: parsed.chapterId,
          minedTokenIdx: parsed.tokenIdx,
        };
      }
    } catch {
      // Capturing context is best-effort; never fail the status change over it.
    }
  }

  try {
    const row = await setKnownLemmaStatus({
      userId: user.id,
      lemmaId,
      status: parsed.status,
      ...mined,
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
