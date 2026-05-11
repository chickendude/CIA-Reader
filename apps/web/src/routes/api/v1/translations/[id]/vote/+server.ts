/**
 * PATCH /api/v1/translations/:id/vote (T-10.4).
 *
 * Body: `{ vote: 'up' | 'down' | null }`. Null clears the caller's vote.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireVerifiedUser } from '$lib/server/auth/require-user.js';
import {
  setTranslationVote,
  TranslationVoteError,
} from '$lib/server/dictionary/votes.js';
import { parseJson } from '../../../auth/_helpers.js';
import type { RequestHandler } from './$types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z.object({
  vote: z.enum(['up', 'down']).nullable(),
});

function mapVoteError(err: unknown): never {
  if (err instanceof TranslationVoteError) {
    throw error(err.status, err.message);
  }
  throw err;
}

export const PATCH: RequestHandler = async (event) => {
  const user = await requireVerifiedUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid translation id');
  const input = await parseJson(event.request, bodySchema);

  try {
    const vote = await setTranslationVote(user.id, id, input.vote);
    return json({ vote });
  } catch (err) {
    mapVoteError(err);
  }
};
