/**
 * DELETE /api/v1/texts/:id/audio/:audioId (T-9.1).
 */
import { error, json } from '@sveltejs/kit';

import { requireUser } from '$lib/server/auth/require-user.js';
import { AudioError, deleteAudio } from '$lib/server/audio/audio.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DELETE: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const audioId = event.params.audioId;
  if (!audioId || !UUID_RE.test(audioId)) throw error(400, 'Invalid audio id');
  try {
    await deleteAudio({
      audioFileId: audioId,
      actor: { id: user.id, role: user.role },
    });
    return json({ ok: true });
  } catch (e) {
    if (e instanceof AudioError) throw error(e.status, e.message);
    throw e;
  }
};
