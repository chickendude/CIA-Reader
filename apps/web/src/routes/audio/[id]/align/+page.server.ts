/**
 * Manual alignment editor (T-9.5) loader.
 *
 * Owner-or-admin only. Loads the audio file's URL + the chapter's
 * tokens grouped by sentence so the page can walk one sentence at
 * a time during playback.
 */
import { error, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';

import { db, schema } from '$lib/server/db/index.js';
import { loadSentenceTokensForAudio } from '$lib/server/audio/sentence-tokens.js';
import { getAudioStorage } from '$lib/server/audio/storage.js';
import type { AudioFile, Text } from '$lib/server/db/schema.js';
import type { PageServerLoad } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const load: PageServerLoad = async ({ params, locals, url }) => {
  if (!locals.user) {
    throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
  }
  const id = params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid audio id');

  const [hit] = (await db
    .select({
      audio: schema.audioFiles,
      ownerId: schema.texts.ownerId,
    })
    .from(schema.audioFiles)
    .innerJoin(schema.texts, eq(schema.texts.id, schema.audioFiles.textId))
    .where(eq(schema.audioFiles.id, id))
    .limit(1)) as Array<{ audio: AudioFile; ownerId: Text['ownerId'] }>;
  if (!hit) throw error(404, 'Audio not found');
  if (locals.user.role !== 'admin' && hit.ownerId !== locals.user.id) {
    throw error(403, 'Only the owner can edit alignments');
  }

  const sentences = await loadSentenceTokensForAudio(id);
  return {
    audio: {
      id: hit.audio.id,
      url: getAudioStorage().urlFor(hit.audio.storageKey),
      mime: hit.audio.mime,
      durationMs: hit.audio.durationMs,
    },
    sentences,
  };
};
