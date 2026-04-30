/**
 * POST /api/v1/me/listening (T-10.5).
 *
 * Records one small playback delta from the audio player. The service rolls
 * deltas into aggregate listening stats; callers should send at most once
 * every few seconds and flush on pause/unload.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  ListeningStatsError,
  recordListeningDelta,
} from '$lib/server/audio/listening.js';
import { parseJson } from '../../auth/_helpers.js';
import type { RequestHandler } from './$types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z.object({
  audioFileId: z.string().regex(UUID_RE),
  listenedMs: z.number().finite().positive().max(60_000),
});

function mapListeningError(err: unknown): never {
  if (err instanceof ListeningStatsError) {
    throw error(err.status, err.message);
  }
  throw err;
}

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const input = await parseJson(event.request, bodySchema);
  try {
    const listening = await recordListeningDelta({
      userId: user.id,
      audioFileId: input.audioFileId,
      listenedMs: input.listenedMs,
    });
    return json({ listening });
  } catch (err) {
    mapListeningError(err);
  }
};
